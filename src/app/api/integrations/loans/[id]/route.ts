import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { Types } from "mongoose";
import { deleteLoan, getLoan, LoanServiceError, loanUpdateSchema, updateLoan } from "@/lib/loan-service";

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

// GET /api/integrations/loans/[id]
export const GET = withIntegrationRoute("loans", async ({ user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid loan id", requestId);
  }
  try {
    return integrationOk(await getLoan(user.id, id), requestId);
  } catch (err) {
    if (err instanceof LoanServiceError) return integrationError("NOT_FOUND", err.message, requestId);
    throw err;
  }
});

// PATCH /api/integrations/loans/[id] — same fields as the browser's PATCH
// /api/loans/[id] (updateLoan in src/lib/loan-service.ts).
export const PATCH = withIntegrationRoute("loans", async ({ req, user, requestId }, ctx: { params: Params }) => {
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
  const parsed = loanUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Update data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:loans:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const loan = await updateLoan({ ...parsed.data, userId: user.id, loanId: id, actor: user });
        return { status: 200, body: loan as unknown as Record<string, unknown> };
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

// DELETE /api/integrations/loans/[id] — same reversal and soft delete as the
// browser's DELETE (deleteLoan in src/lib/loan-service.ts).
export const DELETE = withIntegrationRoute("loans", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid loan id", requestId);
  }

  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:loans:DELETE",
    key: idempotencyKey,
    body: { id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        await deleteLoan(user.id, id, user);
        return { status: 200, body: { id, deleted: true } };
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
