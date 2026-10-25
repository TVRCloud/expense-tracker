import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError } from "@/lib/integrations/response";
import { idempotentShareWrite, readShareBody } from "@/lib/integrations/share-http";
import { acceptInvite, currentMemberShare, shareAcceptSchema } from "@/lib/share-service";

type Params = Promise<{ id: string }>;

// POST /api/integrations/shares/[id]/accept { code } — accept an invite made for your email.
// The code must match and works once. Every miss (wrong code, expired, someone else's invite,
// already used) is the same 404.
export const POST = withIntegrationRoute("household", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  const read = await readShareBody(req, requestId);
  if (!read.ok) return read.res;
  const raw = read.body as { code?: unknown } | null;
  const parsed = shareAcceptSchema.safeParse({ token: raw && typeof raw === "object" ? raw.code : undefined });
  if (!parsed.success) return integrationError("VALIDATION_ERROR", "Send the invite code", requestId);
  let firstView: unknown = null;
  return idempotentShareWrite({
    req,
    requestId,
    userId: user.id,
    endpoint: `integrations:shares:accept:${id}`,
    // The code stays out of the stored fingerprint input: only the share id identifies a retry.
    fingerprintBody: { id },
    // Only the id is stored. The full view goes out with the first answer; a replay is built live,
    // so a share revoked or left since is a 404, not a stale "active" view.
    execute: async () => {
      const share = await acceptInvite(user, id, parsed.data.token);
      firstView = share;
      return { status: 200, body: { share: { id: share.id } } };
    },
    extraOnce: () => ({ share: firstView }),
    onReplay: async () => ({ share: await currentMemberShare(user.id, id) }),
  });
});
