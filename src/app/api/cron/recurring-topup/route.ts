import { NextRequest, NextResponse } from "next/server";
import { topUpRecurringSeries } from "@/lib/recurring-topup";
import { runReminderChecks } from "@/lib/reminder-scheduler";
import { promoteStalePendingSms } from "@/lib/capture/ingest";
import { isAuthorizedCron } from "@/lib/cron-auth";
import logger from "@/lib/logger";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await Promise.all([topUpRecurringSeries(), runReminderChecks(), promoteStalePendingSms()]);
  logger.info("Cron: recurring top-up + reminder checks + pending-SMS promotion completed");
  return NextResponse.json({ ok: true });
}
