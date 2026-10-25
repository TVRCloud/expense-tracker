import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { readJsonBodyLimited } from "@/lib/integrations/write-helpers";
import { importRequestSchema, previewImport, TransactionImportError } from "@/lib/transaction-import";

// The 1 MB csv plus its JSON wrapper and the other fields.
const MAX_BODY_BYTES = 1_100_000;

// The same limit as commit: a preview reads the file and the account's rows, and
// a file near the caps is not instant on a loaded database. Next needs the
// literal here.
export const maxDuration = 60;

// POST /api/integrations/import/preview — dry run of a CSV import. Nothing is
// written, so no Idempotency-Key. Without `mapping` the columns are guessed
// from the header; the answer carries the guess so the app can show it.
export const POST = withIntegrationRoute("import", async ({ req, user, requestId }) => {
  // Bytes are counted as they arrive; the file itself is capped at 1 MB.
  const read = await readJsonBodyLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return integrationError(
      "VALIDATION_ERROR",
      read.reason === "too_large" ? "The file is too large to import in one go" : "Request body must be valid JSON",
      requestId
    );
  }
  const parsed = importRequestSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Import data is invalid", requestId, { details: parsed.error.flatten() });
  }
  try {
    return integrationOk(await previewImport(user.id, parsed.data), requestId);
  } catch (err) {
    if (err instanceof TransactionImportError) {
      if (err.code === "ACCOUNT_NOT_FOUND") return integrationError("NOT_FOUND", err.message, requestId);
      if (err.code === "IMPORT_IN_PROGRESS") return integrationError("CONFLICT", err.message, requestId);
      return integrationError("VALIDATION_ERROR", err.message, requestId, { details: { code: err.code, ...err.details } });
    }
    throw err;
  }
});
