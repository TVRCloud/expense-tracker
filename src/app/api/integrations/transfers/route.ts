import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { createTransfer, TransferServiceError, transferCreateSchema } from "@/lib/transfer-service";

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

// POST /api/integrations/transfers — move money between two of the caller's
// own accounts. Same balance and ledger rules as a type "transfer" row from
// POST /api/integrations/transactions (createTransfer wraps that service), with
// a smaller contract: it never counts as income or spending.
export const POST = withIntegrationRoute("transfers", async ({ req, user, requestId }) => {
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
  const parsed = transferCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Transfer data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:transfers:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const transfer = await createTransfer({ ...parsed.data, userId: user.id, actor: user });
        return { status: 201, body: transfer as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof TransferServiceError) {
          return { status: err.code === "TRANSFER_CURRENCY_MISMATCH" ? 400 : 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode === "TRANSFER_CURRENCY_MISMATCH") {
    return integrationError("VALIDATION_ERROR", body_.message ?? "Request failed", requestId);
  }
  if (body_.errorCode) {
    return integrationError("NOT_FOUND", body_.message ?? "Account not found", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
