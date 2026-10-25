import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { getAaStatus } from "@/lib/aa-service";

// GET /api/integrations/aa — { configured, provider, consents[] }. Works when bank linking is off
// (configured:false, no consents). Never returns the provider's handle for a consent.
export const GET = withIntegrationRoute("aa", async ({ user, requestId }) => {
  return integrationOk(await getAaStatus(user.id), requestId);
});
