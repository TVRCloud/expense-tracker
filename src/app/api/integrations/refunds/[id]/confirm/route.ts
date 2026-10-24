import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError } from "@/lib/integrations/response";
import { integrationReviewMutation } from "@/lib/reconcile/http";
import { confirmRefund, refundConfirmSchema } from "@/lib/refund-service";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/integrations/refunds/:id/confirm — "Yes, this is the refund".
// Body (optional): { originalId } to link a different expense than the
// suggested one. The refund takes that expense's category and comes off it in
// the stats and the budget. Requires an Idempotency-Key header.
export const POST = withIntegrationRoute<Ctx>("refunds", async ({ req, user, requestId }, { params }) => {
  const { id } = await params;
  const text = await req.text();
  let json: unknown = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
    }
  }
  const parsed = refundConfirmSchema.safeParse(json);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Refund data is invalid", requestId, { details: parsed.error.flatten() });
  }
  return integrationReviewMutation({
    req,
    userId: user.id,
    requestId,
    endpoint: `integrations:refunds:confirm:${id}`,
    body: parsed.data,
    execute: async () => ({ refund: await confirmRefund(user.id, id, parsed.data) }),
  });
});
