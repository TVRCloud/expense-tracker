import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { commitImport, importCommitSchema, TransactionImportError } from "@/lib/transaction-import";

// A row-by-row write of up to 1,000 rows.
export const maxDuration = 60;

const MAX_BODY_BYTES = 1_500_000;

// POST /api/integrations/import/commit — writes what /import/preview showed.
// Needs an Idempotency-Key; the same key with the same body replays the answer.
export const POST = withIntegrationRoute("import", async ({ req, user, requestId }) => {
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  // Refuse an oversized body before reading it all (the file itself is capped at 1 MB).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return integrationError("VALIDATION_ERROR", "The file is too large to import in one go", requestId);
  }
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = importCommitSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Import data is invalid", requestId, { details: parsed.error.flatten() });
  }

  try {
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:import:commit:POST",
      key,
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
      return integrationError("VALIDATION_ERROR", err.message, requestId, { details: { code: err.code, ...err.details } });
    }
    throw err;
  }
});
