import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { getCreditSummary } from "@/lib/credit-card-service";

// GET /api/integrations/credit-cards/summary — same numbers as the browser's
// GET /api/credit-cards/summary (src/lib/credit-card-service.ts).
export const GET = withIntegrationRoute("credit-cards", async ({ user, requestId }) => {
  return integrationOk(await getCreditSummary(user.id), requestId);
});
