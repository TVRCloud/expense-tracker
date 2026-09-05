import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getMonthlyStats } from "@/lib/stats-service";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

    const stats = await getMonthlyStats(user.id, year, month);
    return NextResponse.json({ data: stats });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/stats failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
