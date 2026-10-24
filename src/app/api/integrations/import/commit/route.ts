import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBodyLimited } from "@/lib/integrations/write-helpers";
import { commitImport, importCommitSchema, TransactionImportError } from "@/lib/transaction-import";

// A row-by-row write of up to 500 rows.
export const maxDuration = 60;

// The 1 MB csv plus its JSON wrapper and the other fields.
const MAX_BODY_BYTES = 1_100_000;

// POST /api/integrations/import/commit — writes what /import/preview showed.
// Needs an Idempotency-Key; the same key with the same body replays the answer.
export const POST = withIntegrationRoute("import", async ({ req, user, requestId }) => {
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  // Bytes are counted as they arrive; the file itself is capped at 1 MB.
  const read = await readJsonBodyLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return integrationError(
      "VALIDATION_ERROR",
      read.reason === "too_large" ? "The file is too large to import in one go" : "Request body must be valid JSON",
      requestId
    );
  }
  const parsed = importCommitSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Import data is invalid", requestId, { details: parsed.error.flatten() });
  }

  try {
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:import:commit:POST",
      key,
      // A killed run leaves its pending record only this long, not a day.
      pendingTtlSeconds: 120,
      // The request fingerprint only reads top-level keys, so the nested mapping
      // goes in as one string.
      body: { ...parsed.data, mapping: JSON.stringify(parsed.data.mapping ?? null) },
      execute: async () => {
        const result = await commitImport(user.id, user, parsed.data);
        return { status: 201, body: result as unknown as Record<string, unknown> };
      },
    });
    if (outcome.kind === "conflict") {
      return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
    }
    return integrationOk(outcome.body, requestId, { status: outcome.status });
  } catch (err) {
    if (err instanceof TransactionImportError) {
      if (err.code === "ACCOUNT_NOT_FOUND") return integrationError("NOT_FOUND", err.message, requestId);
      if (err.code === "IMPORT_IN_PROGRESS") return integrationError("CONFLICT", err.message, requestId);
      return integrationError("VALIDATION_ERROR", err.message, requestId, { details: { code: err.code, ...err.details } });
    }
    throw err;
  }
});
