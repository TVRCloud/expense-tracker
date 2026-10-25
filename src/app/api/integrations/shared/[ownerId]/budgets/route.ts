import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { shareErrorResponse } from "@/lib/integrations/share-http";
import { loadActiveShare, sharedBudgetsView } from "@/lib/share-service";

type Params = Promise<{ ownerId: string }>;

// GET /api/integrations/shared/[ownerId]/budgets?month&year — the owner's budgets for the month,
// only when the share includes budgets (otherwise 404). `spent` is the owner's spending in that
// category across all their accounts, not only the shared ones.
export const GET = withIntegrationRoute("shared", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { ownerId } = await ctx.params;
  const shared = await loadActiveShare(user.id, ownerId);
  if (!shared) return integrationError("NOT_FOUND", "Not found", requestId);
  const q = new URL(req.url).searchParams;
  const month = q.get("month") === null ? undefined : Number(q.get("month"));
  const year = q.get("year") === null ? undefined : Number(q.get("year"));
  try {
    return integrationOk(await sharedBudgetsView(shared, month, year), requestId);
  } catch (err) {
    const mapped = shareErrorResponse(err, requestId);
    if (mapped) return mapped;
    throw err;
  }
});
