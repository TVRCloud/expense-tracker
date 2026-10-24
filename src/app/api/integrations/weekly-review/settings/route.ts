import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import {
  getWeeklyReviewSettings,
  updateWeeklyReviewSettings,
  weeklyReviewSettingsSchema,
} from "@/lib/weekly-review-settings";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/weekly-review/settings — { enabled, day }. The review
// notification is off until the user turns it on; day is 0 (Sunday) to 6.
export const GET = withIntegrationRoute("weekly-review", async ({ user, requestId }) => {
  return integrationOk(await getWeeklyReviewSettings(user.id), requestId);
});

// PATCH /api/integrations/weekly-review/settings — send `enabled` (boolean)
// and/or `day` (0 to 6). Only the fields sent change.
export const PATCH = withIntegrationRoute("weekly-review", async ({ req, user, requestId }) => {
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = weeklyReviewSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Weekly review settings are invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:weekly-review-settings:PATCH",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => ({
      status: 200,
      body: (await updateWeeklyReviewSettings(user.id, parsed.data)) as unknown as Record<string, unknown>,
    }),
  });

  if (outcome.kind === "conflict") {
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      outcome.reason === "fingerprint_mismatch"
        ? "Idempotency-Key was already used with a different request body"
        : "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
