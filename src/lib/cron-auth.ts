import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

// Same sha256-hash + timingSafeEqual pattern as the n8n integration's
// isValidKey (src/lib/integrations/auth.ts) — hashing both sides to a fixed
// length avoids leaking the secret's length or a partial match via response
// timing, and sidesteps timingSafeEqual's own throw on mismatched lengths.
function isValidCronSecret(supplied: string, configured: string): boolean {
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(suppliedHash, configuredHash);
}

/** `Authorization: Bearer $CRON_SECRET` check shared by /api/cron/* routes. */
export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const supplied = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return Boolean(secret && supplied && isValidCronSecret(supplied, secret));
}
