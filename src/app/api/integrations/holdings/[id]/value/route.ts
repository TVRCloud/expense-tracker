import { withIntegrationRoute } from "@/lib/integrations/handler";
import { holdingIdParam, holdingWrite } from "@/lib/integrations/holding-http";
import { holdingValueSchema, recordHoldingValue } from "@/lib/holding-service";

type Params = Promise<{ id: string }>;

// POST /api/integrations/holdings/[id]/value — a new manual value: { value } (the total, minor units) or
// { price } (a decimal string, up to 4 decimals, times the units held). Idempotent.
export const POST = withIntegrationRoute("holdings", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const got = await holdingIdParam(ctx, requestId);
  if ("response" in got) return got.response;
  return holdingWrite({
    req,
    userId: user.id,
    requestId,
    endpoint: "VALUE",
    schema: holdingValueSchema,
    extra: { id: got.id },
    run: (input) => recordHoldingValue(user.id, got.id, input),
  });
});
