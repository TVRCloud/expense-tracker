import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { receiptIntegrationCode } from "@/lib/integrations/receipt-errors";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf } from "@/lib/integrations/write-helpers";
import { createHash } from "crypto";
import IdempotencyRecord from "@/models/IdempotencyRecord";
import {
  addReceipt,
  listReceipts,
  MAX_RECEIPT_BYTES,
  preflightReceipt,
  readReceiptBody,
  ReceiptServiceError,
  type ReceiptServiceErrorCode,
} from "@/lib/receipt-service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/integrations/transactions/[id]/receipts — the receipts on a transaction (no image bytes).
export const GET = withIntegrationRoute("receipts", async ({ user, requestId }, ctx: Ctx) => {
  const { id } = await ctx.params;
  try {
    return integrationOk(await listReceipts(user.id, id), requestId);
  } catch (err) {
    if (err instanceof ReceiptServiceError) return integrationError(receiptIntegrationCode(err.code), err.message, requestId);
    throw err;
  }
});

// POST /api/integrations/transactions/[id]/receipts — the request body is the raw image
// (JPEG, PNG, WebP or HEIC, up to 3 MB). The Content-Type header is ignored: the type is read
// from the file itself.
export const POST = withIntegrationRoute("receipts", async ({ req, user, requestId }, ctx: Ctx) => {
  const { id } = await ctx.params;
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);

  // Refuse what can be refused before the body is read (no transaction, five already, quota full). A key
  // seen before skips this so a retry of an upload that worked still gets its stored answer.
  const seen = await IdempotencyRecord.exists({ userId: user.id, endpoint: "integrations:receipts:POST", key });
  if (!seen) {
    try {
      const declared = Number(req.headers.get("content-length"));
      await preflightReceipt(user.id, id, Number.isFinite(declared) ? declared : undefined);
    } catch (err) {
      if (err instanceof ReceiptServiceError) return integrationError(receiptIntegrationCode(err.code), err.message, requestId, { reason: err.code });
      throw err;
    }
  }

  const read = await readReceiptBody(req, user.id, MAX_RECEIPT_BYTES);
  if (!read.ok) {
    if (read.reason === "busy") {
      return integrationError("RATE_LIMITED", "Another upload is still being received; try again in a moment", requestId, { retryAfterSeconds: 5, reason: "busy" });
    }
    if (read.reason === "timeout") {
      return integrationError("VALIDATION_ERROR", "The upload took too long", requestId, { reason: "timeout" });
    }
    return integrationError("VALIDATION_ERROR", `A receipt can be at most ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB`, requestId, {
      reason: "TOO_LARGE",
    });
  }
  const bytes = read.bytes;

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:receipts:POST",
    key,
    body: { id, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        return { status: 201, body: { ...(await addReceipt({ userId: user.id, transactionId: id, bytes })) } };
      } catch (err) {
        if (err instanceof ReceiptServiceError) return { status: 400, body: { errorCode: err.code, message: err.message } };
        throw err;
      }
    },
  });
  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const body = outcome.body as { errorCode?: ReceiptServiceErrorCode; message?: string } & Record<string, unknown>;
  if (body.errorCode) {
    return integrationError(receiptIntegrationCode(body.errorCode), body.message ?? "Request failed", requestId, { reason: body.errorCode });
  }
  return integrationOk(body, requestId, { status: outcome.status });
});
