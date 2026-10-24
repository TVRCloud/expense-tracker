import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { createRule, listRules, RuleServiceError, ruleCreateSchema, ruleErrorStatus } from "@/lib/rule-service";

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

// GET /api/integrations/rules — every rule, in the order they run.
export const GET = withIntegrationRoute("rules", async ({ user, requestId }) => {
  return integrationOk(await listRules(user.id), requestId);
});

// POST /api/integrations/rules — same service as the browser's POST /api/rules.
export const POST = withIntegrationRoute("rules", async ({ req, user, requestId }) => {
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
  const parsed = ruleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Rule data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:rules:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const rule = await createRule({ ...parsed.data, userId: user.id });
        return { status: 201, body: rule as unknown as Record<string, unknown> };
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
  if (body_.errorCode) {
    const code = outcome.status === 404 ? "NOT_FOUND" : outcome.status === 400 ? "VALIDATION_ERROR" : "CONFLICT";
    return integrationError(code, body_.message ?? "Rule not saved", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
