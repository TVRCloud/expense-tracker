import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { changeTaxCategories, getTaxSettings, taxSettingsDiffSchema, taxSettingsSchema, updateTaxSettings } from "@/lib/tax-settings";

// GET /api/integrations/tax/settings — { deductibleCategories }.
export const GET = withIntegrationRoute("tax", async ({ user, requestId }) => {
  return integrationOk(await getTaxSettings(user.id), requestId);
});

// PUT /api/integrations/tax/settings — replace the deductible category list.
export const PUT = withIntegrationRoute("tax", async ({ req, user, requestId }) => {
  const idempotencyKey = idempotencyKeyOf(req);
  if (!idempotencyKey) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = taxSettingsSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Tax settings are invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:tax-settings:PUT",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => ({ status: 200, body: (await updateTaxSettings(user.id, parsed.data)) as unknown as Record<string, unknown> }),
  });
  if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});

// PATCH /api/integrations/tax/settings — { add?: string[], remove?: string[] }:
// change the list by what moved, atomically (PUT still replaces it all).
// 400 when the list would pass 50 names.
export const PATCH = withIntegrationRoute("tax", async ({ req, user, requestId }) => {
  const idempotencyKey = idempotencyKeyOf(req);
  if (!idempotencyKey) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = taxSettingsDiffSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Send add or remove as lists of names", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:tax-settings:PATCH",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => {
      const result = await changeTaxCategories(user.id, parsed.data);
      return result
        ? { status: 200, body: result as unknown as Record<string, unknown> }
        : { status: 400, body: { errorCode: "VALIDATION_ERROR", message: "At most 50 categories" } };
    },
  });
  if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  if (outcome.status === 400) return integrationError("VALIDATION_ERROR", "At most 50 categories", requestId);
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
