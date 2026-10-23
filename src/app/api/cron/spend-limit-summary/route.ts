import { NextRequest, NextResponse } from "next/server";
import { sendSpendLimitSummaries } from "@/lib/spend-limit";
import { isAuthorizedCron } from "@/lib/cron-auth";
import logger from "@/lib/logger";

// GET /api/cron/spend-limit-summary — sends each user's end-of-day spend
// limit summary once their local evening has started (21:00 in their time
// zone, see SUMMARY_FROM_HOUR). On the custom server this also runs every 30
// minutes from server.ts. On Vercel the only scheduled job is the daily one in
// vercel.json, which cannot hit every time zone's evening, so call this from
// any scheduler (e.g. an n8n Schedule node every 30 minutes) with
// `Authorization: Bearer $CRON_SECRET`. It never sends twice for the same day.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendSpendLimitSummaries();
  logger.info(result, "Cron: spend limit summaries completed");
  return NextResponse.json({ ok: true, ...result });
}
