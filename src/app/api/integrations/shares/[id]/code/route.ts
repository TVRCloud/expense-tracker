import { withIntegrationRoute } from "@/lib/integrations/handler";
import { idempotentShareWrite } from "@/lib/integrations/share-http";
import { rotateInviteCode } from "@/lib/share-service";

type Params = Promise<{ id: string }>;

// POST /api/integrations/shares/[id]/code — the owner asks for a new invite code for a pending
// invite (the first was lost). The old code stops working. { share, code }, shown once.
export const POST = withIntegrationRoute("household", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  let code: string | null = null;
  return idempotentShareWrite({
    req,
    requestId,
    userId: user.id,
    endpoint: `integrations:shares:code:${id}`,
    fingerprintBody: { id },
    execute: async () => {
      const rotated = await rotateInviteCode(user.id, id);
      code = rotated.token;
      return { status: 200, body: { share: rotated.share } };
    },
    extraOnce: () => ({ code }),
  });
});
