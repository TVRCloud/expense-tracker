import type { NextRequest } from "next/server";
import type { ZodType } from "zod";
import { Types } from "mongoose";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { HoldingError, holdingIntegrationCode, holdingStatus } from "@/lib/holding-service";

// The steps every holdings write repeats: the Idempotency-Key, the JSON body,
// the schema, the idempotent run, and the answer to a HoldingError. A business
// error is stored under the key like the other routes (same input, same
// answer), and comes back as { error: { code, message, details: { errorCode } } }.

type Params = Promise<{ id: string }>;

// withIdempotency fingerprints only the top-level keys of its body (a nested object is cut down to the keys
// that also appear at the top), so the parsed input goes in as one canonical string.
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)]))
        : v;
  return JSON.stringify(sort(value));
}

export async function holdingIdParam(ctx: { params: Params }, requestId: string): Promise<{ id: string } | { response: Response }> {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return { response: integrationError("VALIDATION_ERROR", "Invalid holding id", requestId) };
  return { id };
}

export async function holdingWrite<T>(opts: {
  req: NextRequest;
  userId: string;
  requestId: string;
  endpoint: string;
  /** Present for routes that take a JSON body. */
  schema?: ZodType<T>;
  /** Part of the idempotency fingerprint besides the body, e.g. the id from the URL. */
  extra?: Record<string, unknown>;
  successStatus?: number;
  run: (input: T) => Promise<unknown>;
}): Promise<Response> {
  const { req, userId, requestId, endpoint, schema, extra, run } = opts;
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);

  let input = undefined as T;
  if (schema) {
    const read = await readJsonBody(req);
    if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
    const parsed = schema.safeParse(read.body);
    if (!parsed.success) {
      return integrationError("VALIDATION_ERROR", "Holding data is invalid", requestId, { details: parsed.error.flatten() });
    }
    input = parsed.data;
  }

  const outcome = await withIdempotency({
    userId,
    endpoint: `integrations:holdings:${endpoint}`,
    key,
    body: { ...extra, ...(schema ? { input: canonical(input) } : {}) },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const body = await run(input);
        return { status: opts.successStatus ?? 200, body: body as Record<string, unknown> };
      } catch (err) {
        if (err instanceof HoldingError) return { status: holdingStatus(err.code), body: { errorCode: err.code, message: err.message } };
        throw err;
      }
    },
  });
  if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  const body = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body.errorCode) {
    return integrationError(holdingIntegrationCode(body.errorCode as HoldingError["code"]), body.message ?? "Holding error", requestId, {
      details: { errorCode: body.errorCode },
    });
  }
  return integrationOk(body, requestId, { status: outcome.status });
}

/** The answer for a HoldingError on a read. */
export function holdingReadError(err: unknown, requestId: string): Response | null {
  if (!(err instanceof HoldingError)) return null;
  return integrationError(holdingIntegrationCode(err.code), err.message, requestId, { details: { errorCode: err.code } });
}
