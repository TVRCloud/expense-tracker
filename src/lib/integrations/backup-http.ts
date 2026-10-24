import type { NextRequest } from "next/server";
import { BackupError, MAX_BACKUP_BYTES } from "@/lib/backup-crypto";
import logger from "@/lib/logger";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";
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
export async function readBackupBody(req: NextRequest, requestId: string): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
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

// What a bucket counts. The first check runs before the body is read; the
// second, once the route knows what the call is. A dry run has its own, wider
// bucket so checking a file never uses up the real restores.
const BUCKETS = {
  request: { limit: 40, label: "requests" },
  export: { limit: 6, label: "exports" },
  restore: { limit: 12, label: "restores" },
  dryRun: { limit: 30, label: "checks" },
} as const;

export async function backupRateLimited(userId: string, bucket: keyof typeof BUCKETS, requestId: string): Promise<Response | null> {
  const check = await checkSecurityRateLimit({ key: `backup:${bucket}:${userId}`, limit: BUCKETS[bucket].limit, windowMs: 10 * 60 * 1000 });
  if (check.allowed) return null;
  return integrationError("RATE_LIMITED", "Too many backup attempts; try again later", requestId, {
    retryAfterSeconds: check.retryAfterSeconds,
  });
}

// Never logs the error object: a failed bulk insert can carry backup documents.
export function backupFailure(err: unknown, requestId: string, route: string): Response {
  if (err instanceof BackupError) {
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
