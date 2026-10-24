import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { setSubscriptionStatus, subscriptionStatusSchema, SubscriptionServiceError } from "@/lib/subscription-service";

type Params = Promise<{ id: string }>;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const ID_PATTERN = /^[0-9a-f]{16}$/;

function requireIdempotencyKey(req: NextRequest) {
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  return key;
}

function conflictMessage(reason: string) {
  return reason === "fingerprint_mismatch"
    ? "Idempotency-Key was already used with a different request"
    : "A request with this Idempotency-Key is still in progress; retry shortly";
}

// PATCH /api/integrations/subscriptions/[id] — { status: "confirmed" |
// "dismissed" | "detected" }, same rules as the browser's PATCH
// /api/subscriptions/[id] (src/lib/subscription-service.ts).
export const PATCH = withIntegrationRoute("subscriptions", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid subscription id", requestId);
  }

  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = subscriptionStatusSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Status must be detected, confirmed or dismissed", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:subscriptions:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const updated = await setSubscriptionStatus(user.id, id, parsed.data.status);
        return { status: 200, body: updated as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof SubscriptionServiceError) {
          return { status: 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError("NOT_FOUND", body_.message ?? "Subscription not found", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
