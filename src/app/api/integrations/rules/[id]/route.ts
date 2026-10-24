import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { deleteRule, RuleServiceError, ruleErrorStatus, ruleUpdateSchema, updateRule } from "@/lib/rule-service";

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

function failure(status: number, message: string | undefined, requestId: string) {
  const code = status === 404 ? "NOT_FOUND" : status === 400 ? "VALIDATION_ERROR" : "CONFLICT";
  return integrationError(code, message ?? "Rule not saved", requestId);
}

// PATCH /api/integrations/rules/[id] — same service as the browser's PATCH /api/rules/[id].
export const PATCH = withIntegrationRoute("rules", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid rule id", requestId);
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
  const parsed = ruleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Update data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:rules:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const rule = await updateRule({ ...parsed.data, userId: user.id, ruleId: id });
        return { status: 200, body: rule as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof RuleServiceError) {
          return { status: ruleErrorStatus(err.code), body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) return failure(outcome.status, body_.message, requestId);
  return integrationOk(body_, requestId, { status: outcome.status });
});

// DELETE /api/integrations/rules/[id] — rules are configuration, so this is a hard delete.
export const DELETE = withIntegrationRoute("rules", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) {
    return integrationError("VALIDATION_ERROR", "Invalid rule id", requestId);
  }
  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:rules:DELETE",
    key: idempotencyKey,
    body: { id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        await deleteRule(user.id, id);
        return { status: 200, body: { id, deleted: true } };
      } catch (err) {
        if (err instanceof RuleServiceError) {
          return { status: ruleErrorStatus(err.code), body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) return failure(outcome.status, body_.message, requestId);
  return integrationOk(body_, requestId, { status: outcome.status });
});
