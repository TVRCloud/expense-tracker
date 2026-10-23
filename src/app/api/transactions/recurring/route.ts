import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { checkEmiDueNotifications } from "@/lib/emi-notifications";
import { runInBackground } from "@/lib/perf/background";
import { listRecurringSeries, listUpcomingInstallments } from "@/lib/recurring-series";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const upcoming = searchParams.get("upcoming");
    const accountId = searchParams.get("accountId");

    // EMI due notifications, after the response (doesn't slow the list).
    runInBackground("emi-due-notifications", () => checkEmiDueNotifications(user.id));

    if (upcoming) {
      return NextResponse.json({ data: await listUpcomingInstallments(user.id, upcoming, accountId) });
    }
    return NextResponse.json({ data: await listRecurringSeries(user.id, accountId) });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/recurring failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
