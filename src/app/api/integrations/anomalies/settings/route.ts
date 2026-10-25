import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import {
  anomalySettingsDiffSchema,
  anomalySettingsSchema,
  changeAnomalySettings,
  getAnomalySettings,
  updateAnomalySettings,
} from "@/lib/anomaly-settings";

class OverTheCap extends Error {}

// GET /api/integrations/anomalies/settings — { enabled, mutedCategories }.
// Alerts are on until the person turns them off.
export const GET = withIntegrationRoute("anomalies", async ({ user, requestId }) => {
  return integrationOk(await getAnomalySettings(user.id), requestId);
});

// PUT — send `enabled` and/or `mutedCategories` (replaces the whole list, up to
// 50 names). Only the fields sent change. Needs an Idempotency-Key.
export const PUT = withIntegrationRoute("anomalies", async ({ req, user, requestId }) => {
  const idempotencyKey = idempotencyKeyOf(req as NextRequest);
  if (!idempotencyKey) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = anomalySettingsSchema.safeParse(read.body);
  if (!parsed.success) return integrationError("VALIDATION_ERROR", "Send enabled and/or mutedCategories (up to 50 names)", requestId);

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:anomaly-settings:PUT",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => ({
      status: 200,
      body: (await updateAnomalySettings(user.id, parsed.data)) as unknown as Record<string, unknown>,
    }),
  });
  if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});

// PATCH — { enabled?, add?, remove? }: switch the alerts and mute or unmute
// categories by what moved, atomically, so two quick changes do not overwrite
// each other. 400 when the list would pass 50 names. Needs an Idempotency-Key.
export const PATCH = withIntegrationRoute("anomalies", async ({ req, user, requestId }) => {
  const idempotencyKey = idempotencyKeyOf(req as NextRequest);
  if (!idempotencyKey) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = anomalySettingsDiffSchema.safeParse(read.body);
  if (!parsed.success) return integrationError("VALIDATION_ERROR", "Send enabled, add or remove (lists of up to 50 names)", requestId);

  try {
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:anomaly-settings:PATCH",
      key: idempotencyKey,
      body: parsed.data,
      execute: async () => {
        const result = await changeAnomalySettings(user.id, parsed.data);
        // Thrown, not returned: the cap clears when the person unmutes something, and a stored
        // refusal would replay for the same key.
        if (!result) throw new OverTheCap();
        return { status: 200, body: result as unknown as Record<string, unknown> };
      },
    });
    if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
    return integrationOk(outcome.body, requestId, { status: outcome.status });
  } catch (err) {
    if (err instanceof OverTheCap) return integrationError("VALIDATION_ERROR", "At most 50 muted categories", requestId);
    throw err;
  }
});
