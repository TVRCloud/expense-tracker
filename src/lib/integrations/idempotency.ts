import { createHash } from "crypto";
import connectDB from "@/lib/mongodb";
import IdempotencyRecord from "@/models/IdempotencyRecord";
import { config } from "@/lib/config";
import logger from "@/lib/logger";

// Persistent (MongoDB-backed) idempotency for mutating integration calls.
// The unique index on (userId, endpoint, key) in IdempotencyRecord is the
// sole concurrency guard — this codebase has no distributed lock or mongoose
// session/transaction support, so a race between two concurrent requests
// carrying the same key is resolved by letting the loser's insert fail with
// a duplicate-key error (E11000) and responding 409, rather than blocking or
// polling for the winner's result.

export type IdempotencyOutcome<T> =
  | { kind: "executed"; status: number; body: T }
  | { kind: "replayed"; status: number; body: unknown }
  | { kind: "conflict"; reason: "fingerprint_mismatch" | "in_progress" };

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

function fingerprint(body: unknown): string {
  // Canonicalize by key-sorting so field order in the request doesn't change
  // the fingerprint. Not a full deep-canonicalizer (nested arrays/objects are
  // JSON.stringify'd as-is) — sufficient for the flat transaction payload
  // shape this is used for.
  const sorted = JSON.stringify(body, Object.keys(body as object).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

export async function withIdempotency<T extends Record<string, unknown>>(params: {
  userId: string;
  endpoint: string;
  key: string;
  body: unknown;
  execute: () => Promise<{ status: number; body: T }>;
  // A long write can be cut off (function timeout) before the cleanup below
  // runs. With this set, the pending record expires after that many seconds
  // instead of the full TTL, so a retry is not blocked for a day; on success
  // the record gets the full TTL.
  pendingTtlSeconds?: number;
  // True for an error that may have been thrown AFTER the write was applied (a dropped
  // acknowledgement, a timeout): the pending record is kept, so a retry under the key
  // is refused instead of running the write a second time, and the error is rethrown.
  keepPendingOn?: (error: unknown) => boolean;
}): Promise<IdempotencyOutcome<T>> {
  const { userId, endpoint, key, body, execute, pendingTtlSeconds, keepPendingOn } = params;
  await connectDB();

  const requestFingerprint = fingerprint(body);
  const fullTtlMs = config.integrations.idempotencyTtlSeconds * 1000;
  const expiresAt = new Date(Date.now() + (pendingTtlSeconds ? Math.min(pendingTtlSeconds * 1000, fullTtlMs) : fullTtlMs));

  try {
    await IdempotencyRecord.create({
      key,
      userId,
      endpoint,
      fingerprint: requestFingerprint,
      status: "pending",
      expiresAt,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const existing = await IdempotencyRecord.findOne({ userId, endpoint, key }).lean<{
      fingerprint: string;
      status: "pending" | "completed";
      responseStatus?: number;
      responseBody?: unknown;
    }>();

    if (!existing) {
      // Extremely unlikely race (deleted between the failed insert and this
      // read) — treat as in-progress and ask the caller to retry.
      return { kind: "conflict", reason: "in_progress" };
    }
    if (existing.fingerprint !== requestFingerprint) {
      return { kind: "conflict", reason: "fingerprint_mismatch" };
    }
    if (existing.status === "completed") {
      return { kind: "replayed", status: existing.responseStatus ?? 200, body: existing.responseBody };
    }
    return { kind: "conflict", reason: "in_progress" };
  }

  let result: { status: number; body: T };
  try {
    result = await execute();
  } catch (error) {
    // The write may have happened: leave the record pending (see keepPendingOn).
    if (keepPendingOn?.(error)) throw error;
    // Don't let a transient failure permanently block retries under this key
    // before the TTL would otherwise expire it.
    try {
      await IdempotencyRecord.deleteOne({ userId, endpoint, key, status: "pending" });
    } catch (cleanupError) {
      logger.error({ err: cleanupError }, "Failed to clean up pending idempotency record");
    }
    throw error;
  }

  // The work is done. If only recording it fails, the record stays pending (a
  // retry is told to wait rather than doing the write again) and the caller
  // still gets the result.
  try {
    await IdempotencyRecord.findOneAndUpdate(
      { userId, endpoint, key },
      {
        $set: {
          status: "completed",
          responseStatus: result.status,
          responseBody: result.body,
          expiresAt: new Date(Date.now() + fullTtlMs),
        },
      }
    );
  } catch (err) {
    logger.error({ err, userId, endpoint }, "Failed to record the idempotency result after a successful write");
  }
  return { kind: "executed", status: result.status, body: result.body };
}
