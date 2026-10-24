import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { listSubscriptions } from "@/lib/subscription-service";

// GET /api/integrations/subscriptions — same list as GET /api/subscriptions
// (src/lib/subscription-service.ts), uncached. Filters: status=detected|
// confirmed|dismissed|all (default hides dismissed), includeLapsed=true.
// Response data: { subscriptions: [...], totals: { count, monthly, yearly } }.
export const GET = withIntegrationRoute("subscriptions", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const list = await listSubscriptions(user.id, {
    status: searchParams.get("status"),
    includeLapsed: searchParams.get("includeLapsed") === "true",
  });
  return integrationOk(list, requestId);
});
