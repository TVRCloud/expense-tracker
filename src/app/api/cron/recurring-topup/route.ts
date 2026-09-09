import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { topUpRecurringSeries } from "@/lib/recurring-topup";
import { runReminderChecks } from "@/lib/reminder-scheduler";
import logger from "@/lib/logger";

// Same sha256-hash + timingSafeEqual pattern as the n8n integration's
// isValidKey (src/lib/integrations/auth.ts) — hashing both sides to a fixed
// length avoids leaking the secret's length or a partial match via response
// timing, and sidesteps timingSafeEqual's own throw on mismatched lengths.
function isValidCronSecret(supplied: string, configured: string): boolean {
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(suppliedHash, configuredHash);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const supplied = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!secret || !supplied || !isValidCronSecret(supplied, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await Promise.all([topUpRecurringSeries(), runReminderChecks()]);
  logger.info("Cron: recurring top-up + reminder checks completed");
  return NextResponse.json({ ok: true });
}
