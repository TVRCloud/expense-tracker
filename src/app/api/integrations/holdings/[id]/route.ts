import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { holdingIdParam, holdingReadError, holdingWrite } from "@/lib/integrations/holding-http";
import { archiveHolding, getHolding, holdingUpdateSchema, updateHolding } from "@/lib/holding-service";

type Params = Promise<{ id: string }>;

// GET /api/integrations/holdings/[id] — one holding with its value history (newest first, at most 100).
export const GET = withIntegrationRoute("holdings", async ({ user, requestId }, ctx: { params: Params }) => {
  const got = await holdingIdParam(ctx, requestId);
  if ("response" in got) return got.response;
  try {
    return integrationOk(await getHolding(user.id, got.id), requestId);
  } catch (err) {
    const res = holdingReadError(err, requestId);
    if (res) return res;
    throw err;
  }
});

// PATCH /api/integrations/holdings/[id] — name, note (null clears), units (null clears), investedAmount,
// sip (null clears), fd (a fixed deposit's terms). The value changes through POST .../value.
export const PATCH = withIntegrationRoute("holdings", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const got = await holdingIdParam(ctx, requestId);
  if ("response" in got) return got.response;
  return holdingWrite({
    req,
    userId: user.id,
    requestId,
    endpoint: "PATCH",
    schema: holdingUpdateSchema,
    extra: { id: got.id },
    run: (input) => updateHolding(user.id, got.id, input),
  });
});

// DELETE /api/integrations/holdings/[id] — archive.
export const DELETE = withIntegrationRoute("holdings", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const got = await holdingIdParam(ctx, requestId);
  if ("response" in got) return got.response;
  return holdingWrite({
    req,
    userId: user.id,
    requestId,
    endpoint: "DELETE",
    extra: { id: got.id },
    run: () => archiveHolding(user.id, got.id),
  });
});
