import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { listRefundSuggestions } from "@/lib/refund-service";

// GET /api/integrations/refunds — credits that look like the money back for an
// earlier expense, each with the expense it probably refunds, newest first.
// Confirm or reject each one with POST /api/integrations/refunds/:id/confirm
// or /reject.
export const GET = withIntegrationRoute("refunds", async ({ user, requestId }) => {
  return integrationOk(await listRefundSuggestions(user.id), requestId);
});
