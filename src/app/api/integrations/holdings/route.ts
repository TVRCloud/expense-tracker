import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { holdingWrite } from "@/lib/integrations/holding-http";
import { createHolding, holdingCreateSchema, listHoldings } from "@/lib/holding-service";

// GET /api/integrations/holdings — every holding with today's value and gain, the totals and the per-kind
// breakdown, and the SIP dates due in the next 60 days.
export const GET = withIntegrationRoute("holdings", async ({ user, requestId }) => {
  return integrationOk(await listHoldings(user.id), requestId);
});

// POST /api/integrations/holdings — add a holding. Idempotent.
export const POST = withIntegrationRoute("holdings", async ({ req, user, requestId }) => {
  return holdingWrite({
    req,
    userId: user.id,
    requestId,
    endpoint: "POST",
    schema: holdingCreateSchema,
    successStatus: 201,
    run: (input) => createHolding(user.id, input),
  });
});
