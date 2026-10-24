import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { billReminderSettingsSchema, getBillReminderSettings, updateBillReminderSettings } from "@/lib/bill-settings";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/bills/settings — { enabled, leadDays }. Reminders are
// off until the user turns them on.
export const GET = withIntegrationRoute("bills", async ({ user, requestId }) => {
  return integrationOk(await getBillReminderSettings(user.id), requestId);
});

// PATCH /api/integrations/bills/settings — send `enabled` (boolean) and/or
// `leadDays` (whole days, 1 to 14). Only the fields sent change.
export const PATCH = withIntegrationRoute("bills", async ({ req, user, requestId }) => {
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
  const parsed = billReminderSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Reminder settings are invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:bills-settings:PATCH",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => ({
      status: 200,
      body: (await updateBillReminderSettings(user.id, parsed.data)) as unknown as Record<string, unknown>,
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
