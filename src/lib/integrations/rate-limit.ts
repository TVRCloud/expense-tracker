import type { NextRequest } from "next/server";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";
import { config } from "@/lib/config";

// Reuses the existing MongoDB-backed rate limiter (src/lib/security-rate-limit.ts)
// instead of introducing a second mechanism. Two key namespaces:
//  - n8n:route:{routeName}:{userId} — normal usage quota, env-configurable so
//    it doesn't need code changes to loosen/tighten for real automation load.
//  - n8n:auth-fail:{ip} — a tighter, fixed limit protecting the API key itself
//    from brute-force guessing, checked before the key comparison runs.

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

export async function checkRouteRateLimit(routeName: string, userId: string) {
  return checkSecurityRateLimit({
    key: `n8n:route:${routeName}:${userId}`,
    limit: config.integrations.rateLimit,
    windowMs: config.integrations.rateWindowMs,
  });
}

const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 10 * 60 * 1000;

export async function checkAuthFailureRateLimit(req: NextRequest) {
  return checkSecurityRateLimit({
    key: `n8n:auth-fail:${clientIp(req)}`,
    limit: AUTH_FAIL_LIMIT,
    windowMs: AUTH_FAIL_WINDOW_MS,
  });
}
