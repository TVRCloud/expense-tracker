import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationReviewMutation } from "@/lib/reconcile/http";
import { confirmTransaction } from "@/lib/reconcile/correct";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/integrations/review/transactions/:id/confirm — "Looks right".
// Requires an Idempotency-Key header.
export const POST = withIntegrationRoute<Ctx>("review", async ({ req, user, requestId }, { params }) => {
  const { id } = await params;
  return integrationReviewMutation({
    req,
    userId: user.id,
    requestId,
    endpoint: `integrations:review:confirm:${id}`,
    body: {},
    execute: async () => {
      await confirmTransaction(user.id, id, user);
      return { transactionId: id, reviewStatus: "confirmed" };
    },
  });
});
