import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { listSips } from "@/lib/holding-service";

// GET /api/integrations/holdings/sips — due dates of every active SIP in the next 60 days, soonest first.
export const GET = withIntegrationRoute("holdings", async ({ user, requestId }) => {
  return integrationOk(await listSips(user.id), requestId);
});
