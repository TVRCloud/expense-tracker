import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { loadActiveShare, sharedSummary } from "@/lib/share-service";

type Params = Promise<{ ownerId: string }>;

// GET /api/integrations/shared/[ownerId]/summary — total balance of the shared accounts and this
// month's income and spending in them (the owner's time zone, confirmed refunds netted).
export const GET = withIntegrationRoute("shared", async ({ user, requestId }, ctx: { params: Params }) => {
  const { ownerId } = await ctx.params;
  const shared = await loadActiveShare(user.id, ownerId);
  if (!shared) return integrationError("NOT_FOUND", "Not found", requestId);
  return integrationOk(await sharedSummary(shared), requestId);
});
