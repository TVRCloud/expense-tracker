import { NextRequest, NextResponse } from "next/server";
import { sendBillReminders } from "@/lib/bill-reminders";
import { isAuthorizedCron } from "@/lib/cron-auth";
import logger from "@/lib/logger";

// GET /api/cron/bill-reminders — reminds each opted-in user about bills inside
// their lead time (preferences.billReminders), from 09:00 on their own clock,
// once per bill per due date. On the custom server this also runs every 30
// minutes from server.ts. On Vercel the only scheduled job is the daily one in
// vercel.json, so call this from any scheduler (e.g. an n8n Schedule node every
// 30 minutes) with `Authorization: Bearer $CRON_SECRET`. Safe to call as often
// as you like: it never sends the same reminder twice.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendBillReminders();
  logger.info(result, "Cron: bill reminders completed");
  return NextResponse.json({ ok: true, ...result });
}
