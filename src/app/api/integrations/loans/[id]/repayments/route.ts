import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { Types } from "mongoose";
import { createRepayment, listRepayments, LoanServiceError, repaymentCreateSchema } from "@/lib/loan-service";

type Params = Promise<{ id: string }>;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

function requireIdempotencyKey(req: NextRequest) {
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  return key;
}

function conflictMessage(reason: string) {
  return reason === "fingerprint_mismatch"
    ? "Idempotency-Key was already used with a different request"
    : "A request with this Idempotency-Key is still in progress; retry shortly";
}

// GET /api/integrations/loans/[id]/repayments — newest first.
export const GET = withIntegrationRoute("loans", async ({ user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid loan id", requestId);
  }
  try {
    return integrationOk(await listRepayments(user.id, id), requestId);
  } catch (err) {
    if (err instanceof LoanServiceError) return integrationError("NOT_FOUND", err.message, requestId);
    throw err;
  }
});

// POST /api/integrations/loans/[id]/repayments — reuses createRepayment(), so
// remainingAmount, settled state and the optional account transaction behave
// exactly as on the browser route and the SMS EMI path.
export const POST = withIntegrationRoute("loans", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid loan id", requestId);
  }

  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = repaymentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Repayment data is invalid", requestId, { details: parsed.error.flatten() });
  }
  if (Number.isNaN(new Date(parsed.data.date).getTime())) {
    return integrationError("VALIDATION_ERROR", "Repayment date is invalid", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:loans:repayments:POST",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const { repayment, isSettled } = await createRepayment({
          loanId: id,
          userId: user.id,
          actor: user,
          amount: parsed.data.amount,
          date: new Date(parsed.data.date),
          note: parsed.data.note,
          accountId: parsed.data.accountId,
        });
        return { status: 201, body: { ...(repayment.toObject() as Record<string, unknown>), isSettled } };
      } catch (err) {
        if (err instanceof LoanServiceError) {
          return { status: 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError("NOT_FOUND", body_.message ?? "Loan not found", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
