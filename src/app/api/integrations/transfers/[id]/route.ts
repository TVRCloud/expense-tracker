import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import {
  deleteTransfer,
  getTransfer,
  TransferServiceError,
  transferUpdateSchema,
  updateTransfer,
} from "@/lib/transfer-service";

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

function errorStatus(code: string): "NOT_FOUND" | "VALIDATION_ERROR" {
  return code === "TRANSFER_NOT_FOUND" || code === "TRANSFER_ACCOUNT_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR";
}

// GET /api/integrations/transfers/[id]
export const GET = withIntegrationRoute("transfers", async ({ user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid transfer id", requestId);
  }
  try {
    return integrationOk(await getTransfer(user.id, id), requestId);
  } catch (err) {
    if (err instanceof TransferServiceError) return integrationError(errorStatus(err.code), err.message, requestId);
    throw err;
  }
});

// PATCH /api/integrations/transfers/[id] — amount, accounts, date, notes.
// Balances are corrected for the old and new movement together.
export const PATCH = withIntegrationRoute("transfers", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid transfer id", requestId);
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
  const parsed = transferUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Update data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:transfers:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const transfer = await updateTransfer({ ...parsed.data, userId: user.id, transferId: id, actor: user });
        return { status: 200, body: transfer as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof TransferServiceError) {
          return { status: 400, body: { errorCode: err.code, message: err.message } };
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
    return integrationError(errorStatus(body_.errorCode), body_.message ?? "Request failed", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});

// DELETE /api/integrations/transfers/[id] — puts both balances back.
export const DELETE = withIntegrationRoute("transfers", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid transfer id", requestId);
  }
  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:transfers:DELETE",
    key: idempotencyKey,
    body: { id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const result = await deleteTransfer(user.id, id, user);
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof TransferServiceError) {
          return { status: 400, body: { errorCode: err.code, message: err.message } };
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
    return integrationError(errorStatus(body_.errorCode), body_.message ?? "Request failed", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
