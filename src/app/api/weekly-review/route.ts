import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { WeeklyReviewError, getWeeklyReview } from "@/lib/weekly-review";

// GET /api/weekly-review?week=2026-10-19 — same review as the integration
// route, for the signed-in browser user.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await getWeeklyReview(user.id, { week: req.nextUrl.searchParams.get("week") }) });
  } catch (err) {
    if (err instanceof WeeklyReviewError) return NextResponse.json({ error: err.message }, { status: 400 });
    logger.error({ err }, "GET /api/weekly-review failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
