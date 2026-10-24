import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationReviewMutation } from "@/lib/reconcile/http";
import { rejectRefund } from "@/lib/refund-service";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/integrations/refunds/:id/reject — "Not a refund". Drops a
// suggestion for good, or unlinks a confirmed refund and gives it back its old
// category. Requires an Idempotency-Key header.
export const POST = withIntegrationRoute<Ctx>("refunds", async ({ req, user, requestId }, { params }) => {
  const { id } = await params;
  return integrationReviewMutation({
    req,
    userId: user.id,
    requestId,
    endpoint: `integrations:refunds:reject:${id}`,
    body: {},
    execute: async () => ({ refund: await rejectRefund(user.id, id) }),
  });
});
