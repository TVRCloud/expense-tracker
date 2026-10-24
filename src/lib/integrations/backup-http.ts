import type { NextRequest } from "next/server";
import { BackupError, MAX_BACKUP_BYTES } from "@/lib/backup-crypto";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";
import { integrationError } from "@/lib/integrations/response";

// Shared by the two backup routes: a bounded body read and a hard per-user
// limit (key derivation is deliberately slow, so it is also a cost to guard).

// The envelope is base64 of at most MAX_BACKUP_BYTES, plus the passphrase and a few fields.
const MAX_BODY_CHARS = Math.ceil((MAX_BACKUP_BYTES * 4) / 3) + 4096;

export async function readBackupBody(req: NextRequest, requestId: string): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
    return { ok: false, res: integrationError("VALIDATION_ERROR", "Backup file is too large", requestId, { reason: "too_large" }) };
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, res: integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId) };
  }
  if (raw.length > MAX_BODY_CHARS) {
    return { ok: false, res: integrationError("VALIDATION_ERROR", "Backup file is too large", requestId, { reason: "too_large" }) };
  }
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, res: integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId) };
  }
}

export async function backupRateLimited(userId: string, op: "export" | "restore", requestId: string): Promise<Response | null> {
  const limit = op === "export" ? 6 : 12;
  const check = await checkSecurityRateLimit({ key: `backup:${op}:${userId}`, limit, windowMs: 10 * 60 * 1000 });
  if (check.allowed) return null;
  return integrationError("RATE_LIMITED", "Too many backup attempts; try again later", requestId, {
    retryAfterSeconds: check.retryAfterSeconds,
  });
}

export function backupFailure(err: unknown, requestId: string): Response | null {
  if (!(err instanceof BackupError)) return null;
  return integrationError("VALIDATION_ERROR", err.message, requestId, { reason: err.reason });
}
