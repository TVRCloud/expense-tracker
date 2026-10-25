import { z } from "zod";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { BillServiceError, markBillPaid } from "@/lib/bills";
import { TransactionServiceError } from "@/lib/transaction-service";
import { LoanServiceError } from "@/lib/loan-service";
import { MAX_MINOR_AMOUNT } from "@/lib/currency";

type Params = Promise<{ id: string }>;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// Optional body: `amount` (minor units, loans only: pay part of what is left)
// and `accountId` (loans: the account the money left from, which also records
// the transaction). Recurring payments are marked paid in full.
const paySchema = z
  .object({
    amount: z.number().int().positive().max(MAX_MINOR_AMOUNT).optional(),
    accountId: z.string().refine((v) => Types.ObjectId.isValid(v), "Invalid account").optional(),
  })
  .strict();

// POST /api/integrations/bills/[id]/pay — marks a bill from GET /bills as paid
// through the same services the browser uses (installment status for recurring
// payments, a repayment for loans). Card statements answer 400 NOT_PAYABLE:
// they are paid by recording the payment on the card.
export const POST = withIntegrationRoute("bills", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id: rawId } = await ctx.params;
  const id = decodeURIComponent(rawId);

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
    }
  }
  const parsed = paySchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Payment data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:bills-pay:POST",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const paid = await markBillPaid(user.id, id, user, parsed.data);
        return { status: 200, body: paid };
      } catch (err) {
        if (err instanceof BillServiceError || err instanceof TransactionServiceError || err instanceof LoanServiceError) {
          return { status: 400, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      outcome.reason === "fingerprint_mismatch"
        ? "Idempotency-Key was already used with a different request"
        : "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }

  const result = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (result.errorCode) {
    const notFound = result.errorCode === "NOT_FOUND" || result.errorCode === "INSTALLMENT_NOT_FOUND";
    return integrationError(notFound ? "NOT_FOUND" : "VALIDATION_ERROR", result.message ?? "Request failed", requestId, {
      reason: result.errorCode,
    });
  }
  return integrationOk(result, requestId, { status: outcome.status });
});
