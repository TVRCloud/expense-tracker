import { NextRequest, NextResponse } from "next/server";
import { recordSnapshotsForAllUsers } from "@/lib/net-worth";
import { isAuthorizedCron } from "@/lib/cron-auth";
import logger from "@/lib/logger";

// GET /api/cron/net-worth-snapshot — stores today's net worth point for every
// active user, so the trend has a point for days nobody opened the app. The
// day's last write wins, so a late-evening run leaves the closing value. On
// the custom server this also runs every 3 hours from server.ts. On Vercel
// call it from any scheduler with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await recordSnapshotsForAllUsers();
  logger.info(result, "Cron: net worth snapshots completed");
  return NextResponse.json({ ok: true, ...result });
}
