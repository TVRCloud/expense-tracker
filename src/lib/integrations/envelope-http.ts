import type { NextRequest } from "next/server";
import type { z } from "zod";
import type { AuthUser } from "@/lib/auth-guard";
import { ENVELOPE_ERROR_STATUS, EnvelopeError, type EnvelopeErrorCode } from "@/lib/envelope-service";
import { integrationError, integrationOk, type IntegrationErrorCode } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { canonicalJson, conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";

// The shared shape of every envelope write on the integration surface: a valid
// Idempotency-Key, a JSON body checked by the zod schema, the service call
// inside withIdempotency, and EnvelopeError turned into the integration error
// the app expects (`error.details.errorCode` carries the service code). The
// error is stored with the idempotency record, so a retry of the same request
// gets the same answer.

const INTEGRATION_CODE: Record<EnvelopeErrorCode, IntegrationErrorCode> = {
  ENVELOPES_DISABLED: "CONFLICT",
  ENVELOPE_NOT_FOUND: "NOT_FOUND",
  INSUFFICIENT: "VALIDATION_ERROR",
  TOO_MANY: "VALIDATION_ERROR",
  PLAN_NOT_EMPTY: "CONFLICT",
  NOTHING_TO_COPY: "NOT_FOUND",
  BASE_CURRENCY_ONLY_TWO_DECIMALS: "BASE_CURRENCY_ONLY_TWO_DECIMALS",
};

export async function envelopeWrite<S extends z.ZodType>(opts: {
  req: NextRequest;
  user: AuthUser;
  requestId: string;
  endpoint: string;
  schema: S;
  invalidMessage: string;
  run: (input: z.infer<S>) => Promise<unknown>;
}): Promise<Response> {
  const { req, user, requestId, endpoint, schema, invalidMessage, run } = opts;
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = schema.safeParse(read.body);
  if (!parsed.success) return integrationError("VALIDATION_ERROR", invalidMessage, requestId, { details: parsed.error.flatten() });

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint,
    key,
    // the plan body has a list of objects, which the fingerprint would otherwise lose
    body: { request: canonicalJson(parsed.data) },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        return { status: 200, body: (await run(parsed.data)) as Record<string, unknown> };
      } catch (err) {
        if (err instanceof EnvelopeError) {
          return { status: ENVELOPE_ERROR_STATUS[err.code], body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });
  if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  const body = outcome.body as { errorCode?: EnvelopeErrorCode; message?: string } & Record<string, unknown>;
  if (outcome.status !== 200 && body.errorCode && body.errorCode in INTEGRATION_CODE) {
    return integrationError(INTEGRATION_CODE[body.errorCode], body.message ?? "Request failed", requestId, {
      details: { errorCode: body.errorCode },
    });
  }
  return integrationOk(body, requestId, { status: outcome.status });
}
