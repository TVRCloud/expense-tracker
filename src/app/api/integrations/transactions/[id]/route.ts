import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { deleteTransaction, TransactionServiceError, transactionUpdateSchema, updateTransaction } from "@/lib/transaction-service";

type Params = Promise<{ id: string }>;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

function requireIdempotencyKey(req: NextRequest) {
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  return key;
}

function errorStatus(code: string): "NOT_FOUND" | "VALIDATION_ERROR" {
  return code === "TRANSACTION_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR";
}

// PATCH /api/integrations/transactions/[id] — same field set and linked-record
// guard as the browser's PATCH /api/transactions/[id] (src/lib/transaction-service.ts).
export const PATCH = withIntegrationRoute("transactions", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid transaction id", requestId);
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
  const parsed = transactionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Update data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:transactions:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async () => {
      try {
        const txn = await updateTransaction({ ...parsed.data, userId: user.id, transactionId: id, actor: user });
        return { status: 200, body: txn as Record<string, unknown> };
      } catch (err) {
        if (err instanceof TransactionServiceError) {
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
        ? "Idempotency-Key was already used with a different request body"
        : "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError(errorStatus(body_.errorCode), body_.message ?? "Request failed", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});

// DELETE /api/integrations/transactions/[id] — reuses the exact same
// balance-reversal logic as the browser's DELETE (transaction-service.ts).
export const DELETE = withIntegrationRoute("transactions", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid transaction id", requestId);
  }

  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:transactions:DELETE",
    key: idempotencyKey,
    body: { id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        await deleteTransaction(user.id, id, user);
        return { status: 200, body: { id, deleted: true } };
      } catch (err) {
        if (err instanceof TransactionServiceError) {
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

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError(errorStatus(body_.errorCode), body_.message ?? "Request failed", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
