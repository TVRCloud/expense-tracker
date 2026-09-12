import { createHash } from "crypto";
import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { parseBankSms } from "@/lib/integrations/sms-parser";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Loan from "@/models/Loan";
import Notification from "@/models/Notification";
import SmsReviewItem from "@/models/SmsReviewItem";
import { createTransaction, TransactionServiceError } from "@/lib/transaction-service";
import { createRepayment, LoanServiceError } from "@/lib/loan-service";
import { sendPushToUser } from "@/lib/push";

const IDEMPOTENCY_ENDPOINT = "integrations:sms:POST";

const bodySchema = z.object({
  text: z.string().min(1).max(2000),
  // When the message was actually received (device timestamp). Falls back to
  // now if omitted — only the credit-card format carries its own date/time,
  // and even that has no year-independent guarantee of matching "now".
  receivedAt: z.string().datetime().optional(),
});

async function queueForReview(params: {
  userId: string;
  rawText: string;
  receivedAt: Date;
  parsedKind: "credit_card_spend" | "loan_emi_payment" | "unknown";
  parsedFields: object | null;
  reason: "unparsed" | "no_matching_account" | "no_matching_loan";
}) {
  const item = await SmsReviewItem.create({
    user: params.userId,
    rawText: params.rawText,
    receivedAt: params.receivedAt,
    parsedKind: params.parsedKind,
    parsedFields: params.parsedFields,
    reason: params.reason,
    status: "pending",
  });

  const title = "Message needs review";
  const body =
    params.reason === "unparsed"
      ? "Got a message that couldn't be read automatically. Check the review queue."
      : params.reason === "no_matching_account"
        ? "Card spend message didn't match any of your cards. Check the review queue."
        : "EMI payment message didn't match any of your loans. Check the review queue.";
  await Notification.create({
    user: params.userId,
    type: "system",
    title,
    body,
    meta: { smsReviewItemId: item._id.toString() },
  });
  void sendPushToUser(params.userId, { title, body, url: "/notifications" });

  return item;
}

// POST /api/integrations/sms — accepts raw bank/NBFC SMS text (from an n8n
// workflow today; unchanged for a future phone app that auto-fetches SMS)
// and turns it into a Transaction or Loan Repayment when it can be matched
// with confidence, otherwise queues it in SmsReviewItem for a person to
// confirm. Never guesses which account/loan a message belongs to.
export const POST = withIntegrationRoute("sms", async ({ req, user, requestId }) => {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Invalid request body", requestId, {
      details: parsed.error.flatten(),
    });
  }
  const { text } = parsed.data;
  const receivedAt = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date();

  // The raw SMS text itself is the natural idempotency key — the same
  // message forwarded twice (a common failure mode for SMS-forwarding setups)
  // should never create two transactions. Callers may still supply their own
  // Idempotency-Key header (e.g. to intentionally allow reprocessing under a
  // different key); it takes priority when present.
  const idempotencyKey =
    req.headers.get("idempotency-key") || createHash("sha256").update(text).digest("hex");

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: IDEMPOTENCY_ENDPOINT,
    key: idempotencyKey,
    body: { text },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      await connectDB();
      const result = parseBankSms(text);

      if (result.kind === "unknown") {
        const item = await queueForReview({
          userId: user.id,
          rawText: text,
          receivedAt,
          parsedKind: "unknown",
          parsedFields: null,
          reason: "unparsed",
        });
        return { status: 202, body: { status: "queued", reviewItemId: item._id.toString() } };
      }

      if (result.kind === "credit_card_spend") {
        const account = await Account.findOne({
          user: user.id,
          type: "credit_card",
          isArchived: false,
          "creditMeta.lastFourDigits": result.cardLast4,
        });
        if (!account) {
          const item = await queueForReview({
            userId: user.id,
            rawText: text,
            receivedAt,
            parsedKind: "credit_card_spend",
            parsedFields: result,
            reason: "no_matching_account",
          });
          return { status: 202, body: { status: "queued", reviewItemId: item._id.toString() } };
        }

        try {
          const { transaction } = await createTransaction({
            userId: user.id,
            actor: user,
            accountId: account._id.toString(),
            type: "expense",
            amount: result.amountMinor,
            currency: result.currency,
            category: "other",
            description: result.merchant,
            note: `Auto-created from SMS: ${result.bankName} card ending ${result.cardLast4}`,
            date: result.date.toISOString(),
            tags: ["source:sms"],
            isRecurring: false,
          });
          const created = transaction as { _id: { toString(): string } };
          return {
            status: 201,
            body: { status: "created", kind: "transaction", id: created._id.toString() },
          };
        } catch (err) {
          if (err instanceof TransactionServiceError) {
            return { status: 404, body: { errorCode: err.code, message: err.message } };
          }
          throw err;
        }
      }

      // result.kind === "loan_emi_payment"
      const loan = await Loan.findOne({
        user: user.id,
        isDeleted: { $ne: true },
        externalLoanId: result.externalLoanId,
      }).lean<{ _id: { toString(): string } }>();
      if (!loan) {
        const item = await queueForReview({
          userId: user.id,
          rawText: text,
          receivedAt,
          parsedKind: "loan_emi_payment",
          parsedFields: result,
          reason: "no_matching_loan",
        });
        return { status: 202, body: { status: "queued", reviewItemId: item._id.toString() } };
      }

      try {
        const { repayment, isSettled } = await createRepayment({
          loanId: loan._id.toString(),
          userId: user.id,
          actor: user,
          amount: result.amountMinor,
          date: receivedAt,
          note: `Auto-created from SMS${result.period ? ` — ${result.period}` : ""}`,
        });
        return {
          status: 201,
          body: { status: "created", kind: "repayment", id: repayment._id.toString(), isSettled },
        };
      } catch (err) {
        if (err instanceof LoanServiceError) {
          return { status: 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    if (outcome.reason === "fingerprint_mismatch") {
      return integrationError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request body",
        requestId
      );
    }
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }

  const body = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if ((outcome.status === 404) && body.errorCode) {
    return integrationError("NOT_FOUND", body.message ?? "Not found", requestId);
  }

  return integrationOk(body, requestId, { status: outcome.status });
});
