import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { BaseCurrencyError, getBaseCurrency, hasMoneyData, setBaseCurrency } from "@/lib/base-currency";
import { currencyName, minorExponent, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { listRates } from "@/lib/exchange-rate-service";
import User from "@/models/User";
import connectDB from "@/lib/mongodb";

const baseSchema = z.object({ base: z.string() });

// GET /api/integrations/currencies — the currencies the app can pick, the
// user's base currency, and today's rates as base units per 1 unit of each
// currency (`rates.USD` is how many base units one dollar buys). `rates` is
// empty and `rateDate` null when the rate provider is down and nothing is
// cached; `stale: true` means the cached table is older than a day.
// `canChangeBase` is false once the user has any transaction, balance, budget,
// goal, loan, fund, asset or spend limit.
export const GET = withIntegrationRoute("currencies", async ({ user, requestId }) => {
  await connectDB();
  const base = await getBaseCurrency(user.id);
  const [{ rates, rateDate, stale }, locked, hasMoney] = await Promise.all([
    listRates(base),
    User.exists({ _id: user.id, baseLocked: true }),
    hasMoneyData(user.id),
  ]);
  return integrationOk(
    {
      base,
      canChangeBase: !locked && !hasMoney,
      currencies: SUPPORTED_CURRENCIES.map((code) => ({ code, name: currencyName(code), exponent: minorExponent(code) })),
      rates,
      rateDate,
      stale,
    },
    requestId
  );
});

// PATCH /api/integrations/currencies — { base: "USD" }. Only while the user has
// no money rows at all; every stored amount is in minor units of the base currency.
export const PATCH = withIntegrationRoute("currencies", async ({ req, user, requestId }) => {
  const idempotencyKey = idempotencyKeyOf(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }
  const json = await readJsonBody(req);
  if (!json.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = baseSchema.safeParse(json.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Currency data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:currencies:PATCH",
    key: idempotencyKey,
    body: parsed.data,
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const base = await setBaseCurrency(user.id, parsed.data.base);
        return { status: 200, body: { base } };
      } catch (err) {
        if (err instanceof BaseCurrencyError) {
          return { status: 400, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const body = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body.errorCode) {
    return integrationError("VALIDATION_ERROR", body.message ?? "Request failed", requestId, {
      details: { errorCode: body.errorCode },
    });
  }
  return integrationOk(body, requestId, { status: outcome.status });
});
