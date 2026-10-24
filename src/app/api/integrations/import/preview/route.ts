import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { readJsonBody } from "@/lib/integrations/write-helpers";
import { importRequestSchema, previewImport, TransactionImportError } from "@/lib/transaction-import";

const MAX_BODY_BYTES = 1_500_000;

// POST /api/integrations/import/preview — dry run of a CSV import. Nothing is
// written, so no Idempotency-Key. Without `mapping` the columns are guessed
// from the header; the answer carries the guess so the app can show it.
export const POST = withIntegrationRoute("import", async ({ req, user, requestId }) => {
  // Refuse an oversized body before reading it all (the file itself is capped at 1 MB).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return integrationError("VALIDATION_ERROR", "The file is too large to import in one go", requestId);
  }
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = importRequestSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Import data is invalid", requestId, { details: parsed.error.flatten() });
  }
  try {
    return integrationOk(await previewImport(user.id, parsed.data), requestId);
  } catch (err) {
    if (err instanceof TransactionImportError) {
      if (err.code === "ACCOUNT_NOT_FOUND") return integrationError("NOT_FOUND", err.message, requestId);
      return integrationError("VALIDATION_ERROR", err.message, requestId, { details: { code: err.code, ...err.details } });
    }
    throw err;
  }
});
