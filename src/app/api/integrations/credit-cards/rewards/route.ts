import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { getRewardsOverview } from "@/lib/card-rewards-service";

// GET /api/integrations/credit-cards/rewards — every active card with its
// reward rule (or null) and the estimate for its current billing cycle.
export const GET = withIntegrationRoute("credit-cards", async ({ user, requestId }) => {
  return integrationOk(await getRewardsOverview(user.id), requestId);
});
