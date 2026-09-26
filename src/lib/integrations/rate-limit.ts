import type { NextRequest } from "next/server";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";
import connectDB from "@/lib/mongodb";
import SecurityRateLimit from "@/models/SecurityRateLimit";
import { config } from "@/lib/config";

// Reuses the existing MongoDB-backed rate limiter (src/lib/security-rate-limit.ts)
// instead of introducing a second mechanism. Two key namespaces:
//  - n8n:route:{routeName}:{apiKeyId} — normal usage quota, per API key (not
//    per user) so e.g. the mobile app and an n8n workflow on the same
//    account each get their own quota instead of sharing one.
//    env-configurable so it doesn't need code changes to loosen/tighten for
//    real automation load.
//  - n8n:auth-fail:{ip} — a tighter, fixed limit protecting API keys in
//    general from brute-force guessing, checked before the DB lookup runs.

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

export async function checkRouteRateLimit(routeName: string, apiKeyId: string) {
  return checkSecurityRateLimit({
    key: `n8n:route:${routeName}:${apiKeyId}`,
    limit: config.integrations.rateLimit,
    windowMs: config.integrations.rateWindowMs,
  });
}

const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;

const authFailKey = (req: NextRequest) => `n8n:auth-fail:${clientIp(req)}`;

/**
 * Is this IP locked out after too many failed auth attempts? Read-only: a
 * successful request must not use up the failure budget (it used to, which
 * capped every caller on one IP at 10 requests per 10 minutes).
 */
export async function checkAuthFailureRateLimit(req: NextRequest) {
  await connectDB();
  const existing = await SecurityRateLimit.findOne({ key: authFailKey(req) }).lean<{
    count: number;
    expiresAt: Date;
  }>();
  if (existing && existing.expiresAt > new Date() && existing.count >= AUTH_FAIL_LIMIT) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.expiresAt.getTime() - Date.now()) / 1000) };
  }
  return { allowed: true };
}

/** Count one failed auth attempt from this IP. */
export async function recordAuthFailure(req: NextRequest) {
  await checkSecurityRateLimit({ key: authFailKey(req), limit: AUTH_FAIL_LIMIT, windowMs: AUTH_FAIL_WINDOW_MS });
}
