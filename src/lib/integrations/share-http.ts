import type { NextRequest } from "next/server";
import { integrationError, integrationOk, type IntegrationErrorCode } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBodyLimited } from "@/lib/integrations/write-helpers";
import { ShareServiceError } from "@/lib/share-service";

const CODE: Record<ShareServiceError["code"], IntegrationErrorCode> = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION_ERROR",
  LIMIT_REACHED: "CONFLICT",
  ALREADY_SHARED: "CONFLICT",
  FORBIDDEN_ROLE: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
};

/** The integration error for a household sharing failure, or null when it is not one. */
export function shareErrorResponse(err: unknown, requestId: string) {
  if (!(err instanceof ShareServiceError)) return null;
  return integrationError(
    CODE[err.code],
    err.message,
    requestId,
    err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds, reason: err.code } : { reason: err.code }
  );
}

const MAX_BODY_BYTES = 8 * 1024;

/** A JSON body (small, byte-capped) for a household write, or the 400 to return. */
export async function readShareBody(req: NextRequest, requestId: string) {
  const read = await readJsonBodyLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return {
      ok: false as const,
      res: integrationError("VALIDATION_ERROR", read.reason === "too_large" ? "Request body is too large" : "Request body must be valid JSON", requestId),
    };
  }
  return { ok: true as const, body: read.body };
}

/**
 * The Idempotency-Key plumbing every household write shares: a key is required,
 * a retry replays the stored answer, and a service error becomes its integration
 * error (the record is dropped on a thrown error, so a retry runs again).
 */
export async function idempotentShareWrite(opts: {
  req: NextRequest;
  requestId: string;
  userId: string;
  endpoint: string;
  fingerprintBody: unknown;
  execute: () => Promise<{ status: number; body: Record<string, unknown> }>;
  /** Added to the first answer only, never stored (a one-time invite code). */
  extraOnce?: () => Record<string, unknown>;
  /** Replaces a replayed answer with a live one (it may throw a ShareServiceError, mapped as usual). */
  onReplay?: () => Promise<Record<string, unknown>>;
}) {
  const key = idempotencyKeyOf(opts.req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", opts.requestId);
  try {
    const outcome = await withIdempotency({
      userId: opts.userId,
      endpoint: opts.endpoint,
      key,
      body: opts.fingerprintBody,
      execute: opts.execute,
    });
    if (outcome.kind === "conflict") {
      return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), opts.requestId);
    }
    if (outcome.kind === "replayed" && opts.onReplay) {
      return integrationOk(await opts.onReplay(), opts.requestId, { status: outcome.status });
    }
    const body = outcome.kind === "executed" && opts.extraOnce ? { ...outcome.body, ...opts.extraOnce() } : outcome.body;
    return integrationOk(body, opts.requestId, { status: outcome.status });
  } catch (err) {
    const mapped = shareErrorResponse(err, opts.requestId);
    if (mapped) return mapped;
    throw err;
  }
}
