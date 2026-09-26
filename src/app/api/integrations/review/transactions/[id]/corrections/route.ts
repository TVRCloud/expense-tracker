import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError } from "@/lib/integrations/response";
import { integrationReviewMutation } from "@/lib/reconcile/http";
import { correctionRequestSchema, correctTransaction } from "@/lib/reconcile/correct";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/integrations/review/transactions/:id/corrections — fix an
// auto-captured transaction from the phone. Body: {changes, reason, note?}.
// reason "duplicate" or "not_a_transaction" voids it. Requires an
// Idempotency-Key header.
export const POST = withIntegrationRoute<Ctx>("review", async ({ req, user, requestId }, { params }) => {
  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = correctionRequestSchema.safeParse(json);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Invalid correction", requestId, { details: parsed.error.flatten() });
  }
  return integrationReviewMutation({
    req,
    userId: user.id,
    requestId,
    endpoint: `integrations:review:correct:${id}`,
    body: parsed.data,
    execute: async () => {
      const { correction } = await correctTransaction({
        userId: user.id,
        transactionId: id,
        ...parsed.data,
        via: "mobile",
        actor: user,
      });
      return { transactionId: id, correctionId: correction._id.toString() };
    },
  });
});
