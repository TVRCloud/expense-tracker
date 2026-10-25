import { withIntegrationRoute } from "@/lib/integrations/handler";
import { idempotentShareWrite } from "@/lib/integrations/share-http";
import { declineInvite } from "@/lib/share-service";

type Params = Promise<{ id: string }>;

// POST /api/integrations/shares/[id]/decline — turn down an invite made for your email (no code needed).
export const POST = withIntegrationRoute("household", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  return idempotentShareWrite({
    req,
    requestId,
    userId: user.id,
    endpoint: `integrations:shares:decline:${id}`,
    fingerprintBody: { id },
    execute: async () => ({ status: 200, body: { share: await declineInvite(user, id) } }),
  });
});
