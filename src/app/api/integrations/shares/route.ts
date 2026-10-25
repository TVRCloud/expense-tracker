import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { idempotentShareWrite, readShareBody, shareErrorResponse } from "@/lib/integrations/share-http";
import { createInvite, listShares, shareInviteSchema } from "@/lib/share-service";

// GET /api/integrations/shares — { owned, received }: the shares you made (live ones)
// and the ones made with you (active, plus pending invites for your email, without codes).
export const GET = withIntegrationRoute("household", async ({ user, requestId }) => {
  try {
    return integrationOk(await listShares(user), requestId);
  } catch (err) {
    const mapped = shareErrorResponse(err, requestId);
    if (mapped) return mapped;
    throw err;
  }
});

// POST /api/integrations/shares — invite someone to see some of your accounts.
// { email, accountIds, role?: "viewer" | "editor", includeBudgets? } -> 201 { share, code }.
// The code is shown once: only its hash is stored and a retry of the same request does not
// repeat it (ask for a new one at POST shares/{id}/code).
export const POST = withIntegrationRoute("household", async ({ req, user, requestId }) => {
  const read = await readShareBody(req, requestId);
  if (!read.ok) return read.res;
  const parsed = shareInviteSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Invite is invalid", requestId, { details: parsed.error.flatten() });
  }
  let code: string | null = null;
  return idempotentShareWrite({
    req,
    requestId,
    userId: user.id,
    endpoint: "integrations:shares:POST",
    fingerprintBody: parsed.data,
    execute: async () => {
      const created = await createInvite(user, parsed.data);
      code = created.token;
      return { status: 201, body: { share: created.share } };
    },
    extraOnce: () => ({ code }),
  });
});
