import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { CreditCardServiceError } from "@/lib/credit-card-service";
import { rewardRuleSchema } from "@/lib/card-rewards";
import { clearRewardRule, getCardRewards, setRewardRule } from "@/lib/card-rewards-service";

type Params = Promise<{ accountId: string }>;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

function cardError(err: unknown, requestId: string) {
  if (err instanceof CreditCardServiceError) {
    return integrationError(err.code === "ACCOUNT_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR", err.message, requestId);
  }
  throw err;
}

// GET /api/integrations/credit-cards/[accountId]/rewards?cycles=3 — the card's
// reward rule and what each billing cycle earned, current cycle first (1 to 12
// cycles, default 3).
export const GET = withIntegrationRoute("credit-cards", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { accountId } = await ctx.params;
  if (!Types.ObjectId.isValid(accountId)) return integrationError("VALIDATION_ERROR", "Invalid account id", requestId);
  const raw = new URL(req.url).searchParams.get("cycles");
  const cycles = raw == null ? 3 : Number(raw);
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 12) {
    return integrationError("VALIDATION_ERROR", "cycles must be a whole number from 1 to 12", requestId);
  }
  try {
    return integrationOk(await getCardRewards(user.id, accountId, cycles), requestId);
  } catch (err) {
    return cardError(err, requestId);
  }
});

function idempotencyConflict(outcome: { reason: string }, requestId: string) {
  return integrationError(
    "IDEMPOTENCY_CONFLICT",
    outcome.reason === "fingerprint_mismatch"
      ? "Idempotency-Key was already used with a different request body"
      : "A request with this Idempotency-Key is still in progress; retry shortly",
    requestId
  );
}

// PUT /api/integrations/credit-cards/[accountId]/rewards — replaces the whole
// rule: { kind: "cashback" | "points", baseRate, categoryRates?: [{ category,
// rate }], cap?: number | null, pointValue?: number | null }. Needs an
// Idempotency-Key.
export const PUT = withIntegrationRoute("credit-cards", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { accountId } = await ctx.params;
  if (!Types.ObjectId.isValid(accountId)) return integrationError("VALIDATION_ERROR", "Invalid account id", requestId);
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = rewardRuleSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Reward rule is invalid", requestId, { details: parsed.error.flatten() });
  }

  try {
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:card-rewards:PUT",
      key,
      // The fingerprint only looks at top-level keys, so the nested rule goes in as one string.
      body: { accountId, rule: JSON.stringify(parsed.data) },
      execute: async () => ({
        status: 200,
        body: { rule: await setRewardRule(user.id, accountId, parsed.data) } as unknown as Record<string, unknown>,
      }),
    });
    if (outcome.kind === "conflict") return idempotencyConflict(outcome, requestId);
    return integrationOk(outcome.body, requestId, { status: outcome.status });
  } catch (err) {
    return cardError(err, requestId);
  }
});

// DELETE /api/integrations/credit-cards/[accountId]/rewards — removes the rule.
// Needs an Idempotency-Key.
export const DELETE = withIntegrationRoute("credit-cards", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { accountId } = await ctx.params;
  if (!Types.ObjectId.isValid(accountId)) return integrationError("VALIDATION_ERROR", "Invalid account id", requestId);
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }
  try {
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:card-rewards:DELETE",
      key,
      body: { accountId },
      execute: async () => {
        await clearRewardRule(user.id, accountId);
        return { status: 200, body: { id: accountId, deleted: true } as Record<string, unknown> };
      },
    });
    if (outcome.kind === "conflict") return idempotencyConflict(outcome, requestId);
    return integrationOk(outcome.body, requestId, { status: outcome.status });
  } catch (err) {
    return cardError(err, requestId);
  }
});
