import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getCreditSummary } from "@/lib/credit-card-service";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    return NextResponse.json({ data: await getCreditSummary(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/credit-cards/summary failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
