import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { listTags } from "@/lib/transaction-query";

// GET /api/integrations/transactions/tags — the user's tags with a row count each, most used first.
export const GET = withIntegrationRoute("transactions", async ({ user, requestId }) => {
  return integrationOk(await listTags(user.id), requestId);
});
