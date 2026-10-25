import { NextRequest, NextResponse } from "next/server";
import { syncAllConsents } from "@/lib/aa-service";
import { isAuthorizedCron } from "@/lib/cron-auth";
import logger from "@/lib/logger";

export const maxDuration = 60;

// GET /api/cron/aa-sync — reads the new transactions of every active bank link not read in the last hour. A no-op
// while bank linking is off (AA_PROVIDER unset). On the custom server this also runs every 6 hours from server.ts; on
// Vercel call it from any scheduler with `Authorization: Bearer $CRON_SECRET`. Safe to call as often as you like.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncAllConsents();
  logger.info(result, "Cron: bank link sync completed");
  return NextResponse.json({ ok: true, ...result });
}
