import { NextRequest, NextResponse } from "next/server";
import { sendWeeklyReviews } from "@/lib/weekly-review";
import { isAuthorizedCron } from "@/lib/cron-auth";
import logger from "@/lib/logger";

// GET /api/cron/weekly-review — sends each opted-in user (preferences.weeklyReview)
// their review of the last completed week, on their chosen weekday from 09:00 on
// their own clock, once per week. On the custom server this also runs every 30
// minutes from server.ts. On Vercel the only scheduled job is the daily one in
// vercel.json, so call this from any scheduler (e.g. an n8n Schedule node every
// 30 minutes) with `Authorization: Bearer $CRON_SECRET`. Safe to call as often
// as you like: it never sends the same week twice.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendWeeklyReviews();
  logger.info(result, "Cron: weekly reviews completed");
  return NextResponse.json({ ok: true, ...result });
}
