import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { getSpendLimitStatus, spendLimitUpdateSchema, updateSpendLimit } from "@/lib/spend-limit";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/spend-limit — the daily and weekly limit settings plus
// today's and this week's progress and the safe-to-spend amount. Same numbers
// as GET /api/spend-limit (src/lib/spend-limit.ts).
export const GET = withIntegrationRoute("spend-limit", async ({ user, requestId }) => {
  return integrationOk(await getSpendLimitStatus(user.id), requestId);
});

// PUT /api/integrations/spend-limit — set, change or clear the limits. Only the
// fields sent change; `null` clears a limit or resumes a paused one.
export const PUT = withIntegrationRoute("spend-limit", async ({ req, user, requestId }) => {
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
  const parsed = spendLimitUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Spend limit data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:spend-limit:PUT",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => {
      const status = await updateSpendLimit(user.id, parsed.data);
      return { status: 200, body: status as unknown as Record<string, unknown> };
    },
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
