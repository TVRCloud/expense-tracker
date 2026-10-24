import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { createSinkingFund, listSinkingFunds, sinkingFundCreateSchema } from "@/lib/sinking-fund-service";

// GET /api/integrations/sinking-funds — every fund with its computed progress
// (remaining, percent, monthsLeft, suggestedMonthly, status) and totals.
export const GET = withIntegrationRoute("sinking-funds", async ({ user, requestId }) => {
  return integrationOk(await listSinkingFunds(user.id), requestId);
});

// POST /api/integrations/sinking-funds — create a fund. Idempotent.
export const POST = withIntegrationRoute("sinking-funds", async ({ req, user, requestId }) => {
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = sinkingFundCreateSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Sinking fund data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:sinking-funds:POST",
    key,
    body: parsed.data,
    execute: async () => {
      const fund = await createSinkingFund({ ...parsed.data, userId: user.id });
      return { status: 201, body: fund as unknown as Record<string, unknown> };
    },
  });
  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
