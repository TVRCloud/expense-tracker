import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { getSavingsRate } from "@/lib/savings-rate";

// GET /api/integrations/savings-rate?months=6 — share of income saved per
// month (oldest first, the last entry is the month in progress), the average
// over the window and a trend. months: 1 to 24, default 6.
export const GET = withIntegrationRoute("savings-rate", async ({ req, user, requestId }) => {
  const raw = new URL(req.url).searchParams.get("months");
  let months = 6;
  if (raw !== null) {
    months = Number(raw);
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      return integrationError("VALIDATION_ERROR", "months must be a whole number from 1 to 24", requestId);
    }
  }
  return integrationOk(await getSavingsRate(user.id, months), requestId);
});
