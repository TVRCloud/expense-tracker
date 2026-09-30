import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import connectDB from "@/lib/mongodb";
import ApiKey from "@/models/ApiKey";
import User from "@/models/User";
import logger from "@/lib/logger";
import type { AuthUser } from "@/lib/auth-guard";
import { integrationError } from "@/lib/integrations/response";
import { checkAuthFailureRateLimit, clientIp, recordAuthFailure } from "@/lib/integrations/rate-limit";
import { TtlCache } from "@/lib/perf/ttl-cache";
import { runInBackground } from "@/lib/perf/background";

type VerifyResult = { user: AuthUser; apiKeyId: string } | { errorResponse: ReturnType<typeof integrationError> };

// Authenticates any /api/integrations/* caller's `Authorization: Bearer <key>`
// header against the api_keys collection (src/models/ApiKey.ts). Each caller
// (n8n, the mobile app, etc.) holds its own key, minted via the api-keys
// script, so one can be revoked without affecting the others. Never affects
// browser/NextAuth auth.
//
// Security notes:
//  - Never logs the Authorization header or the API key value, in success or
//    failure paths — only a boolean outcome is logged.
//  - The raw key is never stored; only its sha256 hash, looked up by exact
//    match. A random high-entropy key can't be meaningfully brute-forced via
//    response timing, so a DB-lookup comparison (unlike comparing two known
//    short secrets) doesn't need an additional timingSafeEqual step.
//  - Auth failures are rate-limited by client IP: a locked-out IP is refused
//    whatever its key lookup returned, which slows brute-force attempts
//    against a key. Only failures count toward the limit; successful
//    requests don't.
type VerifiedKey = { apiKeyId: string; expiresAt: number | null; user: AuthUser };

// Verified keys, by sha256 hash. Every mobile/n8n request used to pay 3-4
// sequential DB round trips here (lockout check, key, user, lastUsedAt
// write) before its handler ran. A revoke on this instance clears the entry
// at once (forgetApiKey); on another warm instance it takes effect within
// the TTL.
const KEY_CACHE_TTL_MS = 30_000;
const keyCache = new TtlCache<VerifiedKey>(KEY_CACHE_TTL_MS);

// lastUsedAt is informational ("last used 2 min ago" in settings): write it
// at most once a minute per key, after the response.
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedWritten = new TtlCache<true>(LAST_USED_THROTTLE_MS);

/** Drop a key from this instance's auth cache (call on revoke). */
export function forgetApiKey(apiKeyId: string) {
  keyCache.deleteWhere((v) => v.apiKeyId === apiKeyId);
}

/** Test hook: forget every cached key and lastUsedAt throttle. */
export function resetAuthCacheForTests() {
  keyCache.clear();
  lastUsedWritten.clear();
}

/** Drop every cached key owned by a user (call on account deactivation). */
export function forgetUserKeys(userId: string) {
  keyCache.deleteWhere((v) => v.user.id === userId);
}

function touchLastUsed(req: NextRequest, apiKeyId: string) {
  if (lastUsedWritten.get(apiKeyId)) return;
  lastUsedWritten.set(apiKeyId, true);
  const ip = clientIp(req);
  runInBackground("apiKey.lastUsedAt", async () => {
    await connectDB();
    await ApiKey.updateOne({ _id: apiKeyId }, { $set: { lastUsedAt: new Date(), lastUsedIp: ip } });
  });
}

function success(req: NextRequest, requestId: string, v: VerifiedKey): VerifyResult {
  touchLastUsed(req, v.apiKeyId);
  logger.info({ requestId, userId: v.user.id, apiKeyId: v.apiKeyId }, "integration auth succeeded");
  return { apiKeyId: v.apiKeyId, user: v.user };
}

async function lookupKey(keyHash: string): Promise<VerifiedKey | "invalid" | "expired"> {
  await connectDB();
  const apiKey = await ApiKey.findOne({ keyHash, revoked: false }).lean<{
    _id: { toString(): string };
    user: { toString(): string };
    expiresAt?: Date | null;
  }>();
  if (!apiKey) return "invalid";
  // Same generic message as an unknown key — an expired key's holder gets no
  // extra signal beyond "this key doesn't work".
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) return "expired";

  const user = await User.findOne({ _id: apiKey.user, isActive: true }).lean<{
    _id: { toString(): string };
    name: string;
    email: string;
    role: string;
    avatar?: string | null;
  }>();
  // Never reveal whether the key's owning account exists — same generic
  // message as an invalid key.
  if (!user) return "invalid";

  return {
    apiKeyId: apiKey._id.toString(),
    expiresAt: apiKey.expiresAt ? apiKey.expiresAt.getTime() : null,
    user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role, avatar: user.avatar },
  };
}

export async function verifyN8nAuth(req: NextRequest, requestId: string): Promise<VerifyResult> {
  const header = req.headers.get("authorization");
  const suppliedKey = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const keyHash = suppliedKey ? hashKey(suppliedKey) : null;

  // Fast path: a key verified in the last few seconds. It is valid, so the
  // brute-force lockout (which only guards guessing) doesn't apply.
  const cached = keyHash ? keyCache.get(keyHash) : undefined;
  if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) {
    return success(req, requestId, cached);
  }

  // Lockout check and key lookup run together instead of one after the
  // other; a locked-out IP is still refused whatever the lookup found.
  const [authFailLimit, found] = await Promise.all([
    checkAuthFailureRateLimit(req),
    keyHash ? lookupKey(keyHash) : Promise.resolve(null),
  ]);

  if (!authFailLimit.allowed) {
    logger.warn({ requestId }, "integration auth-failure rate limit exceeded");
    return {
      errorResponse: integrationError("RATE_LIMITED", "Too many authentication attempts", requestId, {
        retryAfterSeconds: authFailLimit.retryAfterSeconds,
      }),
    };
  }

  if (!header || !header.startsWith("Bearer ")) {
    logger.warn({ requestId }, "integration auth failed: missing or malformed Authorization header");
    await recordAuthFailure(req);
    return { errorResponse: integrationError("UNAUTHORIZED", "Missing or malformed Authorization header", requestId) };
  }

  if (!suppliedKey || found === null || found === "invalid" || found === "expired") {
    const why = !suppliedKey ? "empty API key" : found === "expired" ? "expired API key" : "invalid, revoked or orphaned API key";
    logger.warn({ requestId }, `integration auth failed: ${why}`);
    await recordAuthFailure(req);
    return { errorResponse: integrationError("UNAUTHORIZED", "Invalid API key", requestId) };
  }

  keyCache.set(keyHash!, found);
  return success(req, requestId, found);
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
