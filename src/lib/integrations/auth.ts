import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import connectDB from "@/lib/mongodb";
import ApiKey from "@/models/ApiKey";
import User from "@/models/User";
import logger from "@/lib/logger";
import type { AuthUser } from "@/lib/auth-guard";
import { integrationError } from "@/lib/integrations/response";
import { checkAuthFailureRateLimit } from "@/lib/integrations/rate-limit";

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
//  - Auth failures are rate-limited by client IP before the DB lookup even
//    runs, to slow brute-force attempts against a key.
export async function verifyN8nAuth(req: NextRequest, requestId: string): Promise<VerifyResult> {
  const authFailLimit = await checkAuthFailureRateLimit(req);
  if (!authFailLimit.allowed) {
    logger.warn({ requestId }, "integration auth-failure rate limit exceeded");
    return {
      errorResponse: integrationError("RATE_LIMITED", "Too many authentication attempts", requestId, {
        retryAfterSeconds: authFailLimit.retryAfterSeconds,
      }),
    };
  }

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    logger.warn({ requestId }, "integration auth failed: missing or malformed Authorization header");
    return { errorResponse: integrationError("UNAUTHORIZED", "Missing or malformed Authorization header", requestId) };
  }

  const suppliedKey = header.slice("Bearer ".length).trim();
  if (!suppliedKey) {
    logger.warn({ requestId }, "integration auth failed: empty API key");
    return { errorResponse: integrationError("UNAUTHORIZED", "Invalid API key", requestId) };
  }

  await connectDB();
  const keyHash = hashKey(suppliedKey);
  const apiKey = await ApiKey.findOne({ keyHash, revoked: false }).lean<{
    _id: { toString(): string };
    user: { toString(): string };
  }>();

  if (!apiKey) {
    logger.warn({ requestId }, "integration auth failed: invalid or revoked API key");
    return { errorResponse: integrationError("UNAUTHORIZED", "Invalid API key", requestId) };
  }

  const user = await User.findOne({ _id: apiKey.user, isActive: true }).lean<{
    _id: { toString(): string };
    name: string;
    email: string;
    role: string;
    avatar?: string | null;
  }>();

  if (!user) {
    // Never reveal whether the key's owning account exists — same generic
    // message as an invalid key.
    logger.warn({ requestId }, "integration auth failed: key's user not found or inactive");
    return { errorResponse: integrationError("UNAUTHORIZED", "Invalid API key", requestId) };
  }

  await ApiKey.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: new Date() } });

  logger.info({ requestId, userId: user._id.toString(), apiKeyId: apiKey._id.toString() }, "integration auth succeeded");
  return {
    apiKeyId: apiKey._id.toString(),
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    },
  };
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
