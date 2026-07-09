import { NextRequest, NextResponse } from "next/server";
import { topUpRecurringSeries } from "@/lib/recurring-topup";
import { runReminderChecks } from "@/lib/reminder-scheduler";
import logger from "@/lib/logger";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await Promise.all([topUpRecurringSeries(), runReminderChecks()]);
  logger.info("Cron: recurring top-up + reminder checks completed");
  return NextResponse.json({ ok: true });
}
