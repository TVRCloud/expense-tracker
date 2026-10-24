import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf } from "@/lib/integrations/write-helpers";
import { receiptIntegrationCode } from "@/lib/integrations/receipt-errors";
import { deleteReceipt, getReceiptImage, receiptImageHeaders, ReceiptServiceError, type ReceiptServiceErrorCode } from "@/lib/receipt-service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/integrations/receipts/[id] — the image itself, decrypted, for its owner only.
// Another user's receipt answers 404, the same as one that does not exist.
export const GET = withIntegrationRoute("receipts", async ({ user, requestId }, ctx: Ctx) => {
  const { id } = await ctx.params;
  try {
    const { contentType, bytes } = await getReceiptImage(user.id, id);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { ...receiptImageHeaders(contentType, bytes.length), "X-Request-ID": requestId },
    });
  } catch (err) {
    if (err instanceof ReceiptServiceError) return integrationError(receiptIntegrationCode(err.code), err.message, requestId);
    throw err;
  }
});

// DELETE /api/integrations/receipts/[id]
export const DELETE = withIntegrationRoute("receipts", async ({ req, user, requestId }, ctx: Ctx) => {
  const { id } = await ctx.params;
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:receipts:DELETE",
    key,
    body: { id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        await deleteReceipt(user.id, id);
        return { status: 200, body: { id, deleted: true } };
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
  if (body.errorCode) return integrationError(receiptIntegrationCode(body.errorCode), body.message ?? "Request failed", requestId);
  return integrationOk(body, requestId, { status: outcome.status });
});
