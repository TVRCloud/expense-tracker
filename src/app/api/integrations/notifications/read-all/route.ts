import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { markAllNotificationsRead } from "@/lib/notification-service";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// POST /api/integrations/notifications/read-all — same as the browser's
// POST /api/notifications/read-all.
export const POST = withIntegrationRoute("notifications", async ({ req, user, requestId }) => {
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:notifications:read-all:POST",
    key: idempotencyKey,
    body: {},
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      await markAllNotificationsRead(user.id);
      return { status: 200, body: { allRead: true } };
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
