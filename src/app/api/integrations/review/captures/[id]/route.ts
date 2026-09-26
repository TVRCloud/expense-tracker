import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationReviewMutation } from "@/lib/reconcile/http";
import { discardCapture } from "@/lib/reconcile/inbox";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/integrations/review/captures/:id — discard a queued message
// (kept on record as discarded, never deleted). Requires an Idempotency-Key.
export const DELETE = withIntegrationRoute<Ctx>("review", async ({ req, user, requestId }, { params }) => {
  const { id } = await params;
  return integrationReviewMutation({
    req,
    userId: user.id,
    requestId,
    endpoint: `integrations:review:discard:${id}`,
    body: {},
    execute: async () => {
      await discardCapture(user.id, id);
      return { captureId: id, status: "discarded" };
    },
  });
});
