import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { contributeToSinkingFund, SinkingFundError, sinkingFundContributeSchema } from "@/lib/sinking-fund-service";

type Params = Promise<{ id: string }>;

// POST /api/integrations/sinking-funds/[id]/contribute — { amount } in paise:
// positive puts money in, negative takes it out (the balance stops at 0).
// Idempotent, so a retried request adds once. Returns the updated fund.
export const POST = withIntegrationRoute("sinking-funds", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return integrationError("VALIDATION_ERROR", "Invalid sinking fund id", requestId);
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = sinkingFundContributeSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Amount is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:sinking-funds:contribute",
    key,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const fund = await contributeToSinkingFund({ userId: user.id, fundId: id, amount: parsed.data.amount });
        return { status: 200, body: fund as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof SinkingFundError) return { status: 404, body: { errorCode: err.code, message: err.message } };
        throw err;
      }
    },
  });
  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const body = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body.errorCode) return integrationError("NOT_FOUND", body.message ?? "Sinking fund not found", requestId);
  return integrationOk(body, requestId, { status: outcome.status });
});
