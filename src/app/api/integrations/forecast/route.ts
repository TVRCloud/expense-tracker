import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { MAX_FORECAST_DAYS, getCashFlowForecast } from "@/lib/cash-flow-forecast";

// GET /api/integrations/forecast?days=30 — the expected balance of the money in
// hand (bank, cash, wallet and savings) day by day, the lowest point and
// whether it goes below zero. `days` is 1 to 60 (default 30). The response
// lists the events used (recurring payments and income, card statements, loans
// owed, subscriptions) and the assumptions, so the screen can explain itself.
// Read-only, additive, uncached.
export const GET = withIntegrationRoute("forecast", async ({ req, user, requestId }) => {
  const raw = new URL(req.url).searchParams.get("days");
  let days: number | undefined;
  if (raw !== null) {
    days = Number(raw);
    if (!/^\d+$/.test(raw) || days < 1 || days > MAX_FORECAST_DAYS) {
      return integrationError("VALIDATION_ERROR", `days must be a whole number from 1 to ${MAX_FORECAST_DAYS}`, requestId);
    }
  }
  return integrationOk(await getCashFlowForecast(user.id, { days }), requestId);
});
