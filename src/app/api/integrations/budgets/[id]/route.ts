import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { BudgetServiceError, budgetUpdateSchema, deleteBudget, updateBudget } from "@/lib/budget-service";

type Params = Promise<{ id: string }>;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

function requireIdempotencyKey(req: NextRequest) {
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  return key;
}

function conflictMessage(reason: string) {
  return reason === "fingerprint_mismatch"
    ? "Idempotency-Key was already used with a different request"
    : "A request with this Idempotency-Key is still in progress; retry shortly";
}

// PATCH /api/integrations/budgets/[id] — same fields and rules as the browser's
// PATCH /api/budgets/[id] (src/lib/budget-service.ts).
export const PATCH = withIntegrationRoute("budgets", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid budget id", requestId);
  }

  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = budgetUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Update data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:budgets:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const updated = await updateBudget({ ...parsed.data, userId: user.id, budgetId: id, actor: user });
        return { status: 200, body: updated as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof BudgetServiceError) {
          return { status: 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError("NOT_FOUND", body_.message ?? "Budget not found", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});

// DELETE /api/integrations/budgets/[id] — soft delete, same as the browser's DELETE.
export const DELETE = withIntegrationRoute("budgets", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid budget id", requestId);
  }

  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:budgets:DELETE",
    key: idempotencyKey,
    body: { id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        await deleteBudget(user.id, id, user);
        return { status: 200, body: { id, deleted: true } };
      } catch (err) {
        if (err instanceof BudgetServiceError) {
          return { status: 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError("NOT_FOUND", body_.message ?? "Budget not found", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
