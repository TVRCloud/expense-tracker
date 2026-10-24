import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import {
  deleteSinkingFund,
  getSinkingFund,
  SinkingFundError,
  sinkingFundUpdateSchema,
  updateSinkingFund,
} from "@/lib/sinking-fund-service";

type Params = Promise<{ id: string }>;

async function fundId(ctx: { params: Params }, requestId: string): Promise<{ id: string } | { response: Response }> {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return { response: integrationError("VALIDATION_ERROR", "Invalid sinking fund id", requestId) };
  }
  return { id };
}

// GET /api/integrations/sinking-funds/[id]
export const GET = withIntegrationRoute("sinking-funds", async ({ user, requestId }, ctx: { params: Params }) => {
  const got = await fundId(ctx, requestId);
  if ("response" in got) return got.response;
  try {
    return integrationOk(await getSinkingFund(user.id, got.id), requestId);
  } catch (err) {
    if (err instanceof SinkingFundError) return integrationError("NOT_FOUND", err.message, requestId);
    throw err;
  }
});

// PATCH /api/integrations/sinking-funds/[id] — name, targetAmount, dueDate,
// monthlyAmount (null clears the plan), icon. The balance only moves through
// POST .../contribute.
export const PATCH = withIntegrationRoute("sinking-funds", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const got = await fundId(ctx, requestId);
  if ("response" in got) return got.response;
  const key = idempotencyKeyOf(req as NextRequest);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = sinkingFundUpdateSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Update data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:sinking-funds:PATCH",
    key,
    body: { id: got.id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const fund = await updateSinkingFund({ ...parsed.data, userId: user.id, fundId: got.id });
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

// DELETE /api/integrations/sinking-funds/[id] — soft delete.
export const DELETE = withIntegrationRoute("sinking-funds", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const got = await fundId(ctx, requestId);
  if ("response" in got) return got.response;
  const key = idempotencyKeyOf(req as NextRequest);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:sinking-funds:DELETE",
    key,
    body: { id: got.id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        await deleteSinkingFund(user.id, got.id);
        return { status: 200, body: { id: got.id, deleted: true } };
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
