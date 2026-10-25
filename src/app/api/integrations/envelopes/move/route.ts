import { withIntegrationRoute } from "@/lib/integrations/handler";
import { envelopeWrite } from "@/lib/integrations/envelope-http";
import { envelopeMoveSchema, moveBetweenEnvelopes } from "@/lib/envelope-service";

// POST /api/integrations/envelopes/move — { month, from, to, amount, allowOverdraw? }.
// Takes `amount` (paise) from one envelope and gives it to another in one atomic
// update. The source may not go below 0, nor below what it has already spent
// unless allowOverdraw is true. Idempotent. Returns the updated plan.
export const POST = withIntegrationRoute("envelopes", async ({ req, user, requestId }) =>
  envelopeWrite({
    req,
    user,
    requestId,
    endpoint: "integrations:envelopes:move",
    schema: envelopeMoveSchema,
    invalidMessage: "Move is invalid",
    run: (input) => moveBetweenEnvelopes(user.id, input),
  })
);
