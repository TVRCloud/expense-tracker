import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { loadActiveShare, sharedAccountsView } from "@/lib/share-service";

type Params = Promise<{ ownerId: string }>;

// GET /api/integrations/shared/[ownerId]/accounts — the accounts this owner shares with you:
// name, type, balance, colour, icon (never card numbers or anything else). 404 unless you are
// the member of an active share of this owner.
export const GET = withIntegrationRoute("shared", async ({ user, requestId }, ctx: { params: Params }) => {
  const { ownerId } = await ctx.params;
  const shared = await loadActiveShare(user.id, ownerId);
  if (!shared) return integrationError("NOT_FOUND", "Not found", requestId);
  return integrationOk(sharedAccountsView(shared), requestId);
});
