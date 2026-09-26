import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { listCorrectionHistory } from "@/lib/reconcile/inbox";

// GET /api/integrations/review/history — every correction, newest first.
export const GET = withIntegrationRoute("review", async ({ user, requestId }) => {
  return integrationOk({ corrections: await listCorrectionHistory(user.id) }, requestId);
});
