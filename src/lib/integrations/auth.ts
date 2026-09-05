import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { config } from "@/lib/config";
import logger from "@/lib/logger";
import type { AuthUser } from "@/lib/auth-guard";
import { integrationError } from "@/lib/integrations/response";
import { checkAuthFailureRateLimit } from "@/lib/integrations/rate-limit";

type VerifyResult = { user: AuthUser } | { errorResponse: ReturnType<typeof integrationError> };

// Authenticates n8n's Authorization: Bearer <N8N_API_KEY> header for
// /api/integrations/* routes only. Never affects browser/NextAuth auth.
//
// Security notes:
//  - Never logs the Authorization header or the API key value, in success or
//    failure paths — only a boolean outcome is logged.
//  - Compares a sha256 hash of both sides with a fixed-length timingSafeEqual,
//    rather than comparing the raw strings, so response timing can't leak the
//    key's length or a partial match.
//  - Auth failures are rate-limited by client IP before the comparison even
//    runs, to slow brute-force attempts against the key.
//  - Resolves to the single configured user via N8N_USER_EMAIL rather than
//    "whichever user exists" — safe if a second account is ever added.
export async function verifyN8nAuth(req: NextRequest, requestId: string): Promise<VerifyResult> {
  const configuredKey = config.integrations.n8nApiKey;
  if (!configuredKey) {
    logger.error({ requestId }, "N8N_API_KEY is not configured");
    return { errorResponse: integrationError("UNAUTHORIZED", "Integration is not configured", requestId) };
  }

  const authFailLimit = await checkAuthFailureRateLimit(req);
  if (!authFailLimit.allowed) {
    logger.warn({ requestId }, "n8n auth-failure rate limit exceeded");
    return {
      errorResponse: integrationError("RATE_LIMITED", "Too many authentication attempts", requestId, {
        retryAfterSeconds: authFailLimit.retryAfterSeconds,
      }),
    };
  }

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    logger.warn({ requestId }, "n8n auth failed: missing or malformed Authorization header");
    return { errorResponse: integrationError("UNAUTHORIZED", "Missing or malformed Authorization header", requestId) };
  }

  const suppliedKey = header.slice("Bearer ".length).trim();
  if (!suppliedKey || !isValidKey(suppliedKey, configuredKey)) {
    logger.warn({ requestId }, "n8n auth failed: invalid API key");
    return { errorResponse: integrationError("UNAUTHORIZED", "Invalid API key", requestId) };
  }

  await connectDB();
  const email = config.integrations.n8nUserEmail.toLowerCase();
  if (!email) {
    logger.error({ requestId }, "N8N_USER_EMAIL is not configured");
    return { errorResponse: integrationError("UNAUTHORIZED", "Integration is not configured", requestId) };
  }

  const user = await User.findOne({ email, isActive: true }).lean<{
    _id: { toString(): string };
    name: string;
    email: string;
    role: string;
    avatar?: string | null;
  }>();

  if (!user) {
    // Never reveal whether the configured email exists — same generic message
    // as an invalid key.
    logger.warn({ requestId }, "n8n auth failed: configured user not found or inactive");
    return { errorResponse: integrationError("UNAUTHORIZED", "Invalid API key", requestId) };
  }

  logger.info({ requestId, userId: user._id.toString() }, "n8n auth succeeded");
  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    },
  };
}

function isValidKey(supplied: string, configured: string): boolean {
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(suppliedHash, configuredHash);
}
