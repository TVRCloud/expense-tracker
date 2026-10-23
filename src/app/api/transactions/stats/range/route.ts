import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getRangeStats, parseMonthList } from "@/lib/stats-service";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const months = parseMonthList(searchParams.get("months"));
    if (months.length === 0) {
      return NextResponse.json({ error: "Provide months as YYYY-M,YYYY-M" }, { status: 400 });
    }

    const data = await getRangeStats(user.id, months);
    return NextResponse.json({ data });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/stats/range failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
