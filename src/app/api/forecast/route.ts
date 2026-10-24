import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { MAX_FORECAST_DAYS, getCashFlowForecast } from "@/lib/cash-flow-forecast";

// GET /api/forecast?days=30 — same forecast as GET /api/integrations/forecast.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const raw = new URL(req.url).searchParams.get("days");
    let days: number | undefined;
    if (raw !== null) {
      days = Number(raw);
      if (!/^\d+$/.test(raw) || days < 1 || days > MAX_FORECAST_DAYS) {
        return NextResponse.json({ error: `days must be a whole number from 1 to ${MAX_FORECAST_DAYS}` }, { status: 400 });
      }
    }
    return NextResponse.json({ data: await getCashFlowForecast(user.id, { days }) });
  } catch (err) {
    logger.error({ err }, "GET /api/forecast failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
