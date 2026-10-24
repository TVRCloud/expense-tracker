import type { NextRequest } from "next/server";
import { BackupError, MAX_BACKUP_BYTES, keyGateOpen } from "@/lib/backup-crypto";
import logger from "@/lib/logger";
import { checkSecurityRateLimit, refundSecurityRateLimit } from "@/lib/security-rate-limit";
import { integrationError } from "@/lib/integrations/response";

// Shared by the backup routes: a bounded body read, hard per-user limits (key
// derivation is deliberately slow, so it is also a cost to guard), and one place
// that turns failures into answers without logging anything from the body.

// The envelope is base64 of at most MAX_BACKUP_BYTES, plus the passphrase and a few fields.
const MAX_BODY_BYTES = Math.ceil((MAX_BACKUP_BYTES * 4) / 3) + 4096;

const tooLarge = (requestId: string) =>
  integrationError("VALIDATION_ERROR", "Backup file is too large", requestId, { reason: "too_large" });
const notJson = (requestId: string) => integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);

// Reads the stream with a running byte count and cancels it past the cap, so a
// missing or false Content-Length cannot make the server hold a huge body.
export type BodyRead = { ok: true; body: unknown } | { ok: false; res: Response; busy?: true };

// At most this many bodies are being read at once in one process; others are told
// to retry, so a crowd of slow uploads cannot hold a pile of buffers.
const MAX_BODY_READS = 4;
let bodyReads = 0;

export async function readBackupBody(req: NextRequest, requestId: string): Promise<BodyRead> {
  if (bodyReads >= MAX_BODY_READS) return { ok: false, res: busyResponse(requestId), busy: true };
  bodyReads += 1;
  try {
    return await readCounted(req, requestId);
  } finally {
    bodyReads -= 1;
  }
}

async function readCounted(req: NextRequest, requestId: string): Promise<BodyRead> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, res: tooLarge(requestId) };

  const stream = req.body;
  if (!stream) return { ok: false, res: notJson(requestId) };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, res: tooLarge(requestId) };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, res: notJson(requestId) };
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, res: notJson(requestId) };
  }
}

// Asked before the body is read: if the key derivation gate is full there is no
// point holding another body in memory behind it.
const busyResponse = (requestId: string) =>
  integrationError("RATE_LIMITED", "The server is busy opening backups; try again in a moment", requestId, {
    retryAfterSeconds: 5,
    reason: "busy",
  });

export function backupBusy(requestId: string): Response | null {
  return keyGateOpen() ? null : busyResponse(requestId);
}

// What a bucket counts. The first check runs before the body is read; the
// second, once the route knows what the call is. A dry run has its own, wider
// bucket so checking a file never uses up the real restores.
const BUCKETS = {
  request: { limit: 40, label: "requests" },
  export: { limit: 6, label: "exports" },
  restore: { limit: 12, label: "restores" },
  dryRun: { limit: 30, label: "checks" },
} as const;

export type BackupBucket = keyof typeof BUCKETS;

export async function backupRateLimited(userId: string, bucket: BackupBucket, requestId: string): Promise<Response | null> {
  const check = await checkSecurityRateLimit({ key: `backup:${bucket}:${userId}`, limit: BUCKETS[bucket].limit, windowMs: 10 * 60 * 1000 });
  if (check.allowed) return null;
  return integrationError("RATE_LIMITED", "Too many backup attempts; try again later", requestId, {
    retryAfterSeconds: check.retryAfterSeconds,
  });
}

export async function refundBackupBuckets(userId: string, buckets: BackupBucket[]) {
  await Promise.all(buckets.map((b) => refundSecurityRateLimit(`backup:${b}:${userId}`))).catch(() => undefined);
}

// Never logs the error object: a failed bulk insert can carry backup documents.
// `counted` are the buckets this call already used; if it is turned away as
// "busy" (other people's load, not the caller's doing) they get them back.
export async function backupFailure(
  err: unknown,
  requestId: string,
  route: string,
  counted?: { userId: string; buckets: BackupBucket[] }
): Promise<Response> {
  if (err instanceof BackupError) {
    if (err.reason === "busy" && counted) await refundBackupBuckets(counted.userId, counted.buckets);
    if (err.reason === "too_large_for_response") {
      return integrationError("TOO_LARGE_FOR_RESPONSE", err.message, requestId, { reason: "too_large_for_response" });
    }
    if (err.reason === "busy") return integrationError("RATE_LIMITED", err.message, requestId, { retryAfterSeconds: 5, reason: "busy" });
    return integrationError("VALIDATION_ERROR", err.message, requestId, { reason: err.reason });
  }
  const e = err as { name?: unknown; code?: unknown } | null;
  logger.error(
    { requestId, route, errName: typeof e?.name === "string" ? e.name : "unknown", errCode: typeof e?.code === "number" || typeof e?.code === "string" ? e.code : undefined },
    "backup request failed"
  );
  return integrationError("INTERNAL_ERROR", "Internal server error", requestId);
}
