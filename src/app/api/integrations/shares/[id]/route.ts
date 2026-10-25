import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError } from "@/lib/integrations/response";
import { idempotentShareWrite, readShareBody } from "@/lib/integrations/share-http";
import { leaveShare, revokeShare, ShareServiceError, shareUpdateSchema, updateShare } from "@/lib/share-service";

type Params = Promise<{ id: string }>;

// PATCH /api/integrations/shares/[id] — the owner changes which accounts, the role or
// includeBudgets. Effective on the member's next request.
export const PATCH = withIntegrationRoute("household", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  const read = await readShareBody(req, requestId);
  if (!read.ok) return read.res;
  const parsed = shareUpdateSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Change is invalid", requestId, { details: parsed.error.flatten() });
  }
  return idempotentShareWrite({
    req,
    requestId,
    userId: user.id,
    endpoint: `integrations:shares:PATCH:${id}`,
    fingerprintBody: parsed.data,
    execute: async () => ({ status: 200, body: { share: await updateShare(user.id, id, parsed.data) } }),
  });
});

// DELETE /api/integrations/shares/[id] — the owner ends the share, or the member leaves it.
// Effective at once. 404 when it is neither yours as owner nor as member.
export const DELETE = withIntegrationRoute("household", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  return idempotentShareWrite({
    req,
    requestId,
    userId: user.id,
    endpoint: `integrations:shares:DELETE:${id}`,
    fingerprintBody: { id },
    execute: async () => {
      try {
        return { status: 200, body: await revokeShare(user.id, id) };
      } catch (err) {
        if (!(err instanceof ShareServiceError) || err.code !== "NOT_FOUND") throw err;
        return { status: 200, body: await leaveShare(user, id) };
      }
    },
  });
});
