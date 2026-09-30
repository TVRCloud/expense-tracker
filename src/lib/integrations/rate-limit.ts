import type { NextRequest } from "next/server";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";
import connectDB from "@/lib/mongodb";
import SecurityRateLimit from "@/models/SecurityRateLimit";
import { config } from "@/lib/config";
import { redis } from "@/lib/redis";

// Two key namespaces:
//  - n8n:route:{routeName}:{apiKeyId} — normal usage quota, per API key (not
//    per user) so e.g. the mobile app and an n8n workflow on the same
//    account each get their own quota instead of sharing one.
//    env-configurable so it doesn't need code changes to loosen/tighten for
//    real automation load.
//    Counted in Redis (see checkRouteRateLimit).
//  - n8n:auth-fail:{ip} — a tighter, fixed limit protecting API keys in
//    general from brute-force guessing. Kept on the MongoDB-backed limiter
//    (src/lib/security-rate-limit.ts): it is only read on requests that miss
//    the auth cache and only written on failures.

export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

// Per-instance fallback windows, used only when Redis is unavailable.
const memoryWindows = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, windowMs: number) {
  const now = Date.now();
  let w = memoryWindows.get(key);
  if (!w || w.resetAt <= now) {
    if (memoryWindows.size > 5000) memoryWindows.clear();
    w = { count: 0, resetAt: now + windowMs };
    memoryWindows.set(key, w);
  }
  w.count += 1;
  return { count: w.count, ttlMs: w.resetAt - now };
}

/** Test hook: reset the per-instance fallback windows. */
export function resetRateLimitWindowsForTests() {
  memoryWindows.clear();
}

/**
 * Normal usage quota, checked on every successful request. One Redis round
 * trip (SET NX PX + INCR + PTTL in a transaction) instead of the two to three
 * Mongo round trips the shared limiter needs; falls back to a per-instance
 * window when Redis is down, so a Redis outage never blocks the app.
 */
export async function checkRouteRateLimit(routeName: string, apiKeyId: string) {
  const key = `n8n:route:${routeName}:${apiKeyId}`;
  const limit = config.integrations.rateLimit;
  const windowMs = config.integrations.rateWindowMs;

  let count: number;
  let ttlMs: number;
  try {
    if (!redis || redis.status !== "ready") throw new Error("redis not ready");
    // SET NX PX opens the window (works on any Redis version, unlike
    // PEXPIRE NX), INCR counts, PTTL says when the window resets.
    const res = await redis.multi().set(key, "0", "PX", windowMs, "NX").incr(key).pttl(key).exec();
    count = Number(res?.[1]?.[1]);
    ttlMs = Number(res?.[2]?.[1]);
    if (!Number.isFinite(count)) throw new Error("bad redis reply");
    if (!Number.isFinite(ttlMs) || ttlMs < 0) ttlMs = windowMs;
  } catch {
    ({ count, ttlMs } = memoryHit(key, windowMs));
  }

  if (count > limit) return { allowed: false as const, retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) };
  return { allowed: true as const, remaining: Math.max(limit - count, 0) };
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
