import { withIntegrationRoute } from "@/lib/integrations/handler";
import { envelopeWrite } from "@/lib/integrations/envelope-http";
import { copyEnvelopePlan, envelopeCopySchema } from "@/lib/envelope-service";

// POST /api/integrations/envelopes/copy — { month, from? }: copy the income and
// envelopes of `from` (default: the month before) into `month`, which must have
// no envelopes yet (409 PLAN_NOT_EMPTY otherwise). Idempotent. Returns the plan.
export const POST = withIntegrationRoute("envelopes", async ({ req, user, requestId }) =>
  envelopeWrite({
    req,
    user,
    requestId,
    endpoint: "integrations:envelopes:copy",
    schema: envelopeCopySchema,
    invalidMessage: "Copy request is invalid",
    run: (input) => copyEnvelopePlan(user.id, input),
  })
);
