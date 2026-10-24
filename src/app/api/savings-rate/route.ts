import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getSavingsRate } from "@/lib/savings-rate";

// ?months=6 (1 to 24)
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const raw = req.nextUrl.searchParams.get("months");
    let months = 6;
    if (raw !== null) {
      months = Number(raw);
      if (!Number.isInteger(months) || months < 1 || months > 24) {
        return NextResponse.json({ error: "months must be a whole number from 1 to 24" }, { status: 400 });
      }
    }
    return NextResponse.json({ data: await getSavingsRate(user.id, months) });
  } catch (err) {
    logger.error({ err }, "GET /api/savings-rate failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
