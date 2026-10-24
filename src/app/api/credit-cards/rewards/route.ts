import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getRewardsOverview } from "@/lib/card-rewards-service";

// Same numbers as GET /api/integrations/credit-cards/rewards.
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json(await getRewardsOverview(user.id));
  } catch (err) {
    logger.error({ err }, "GET /api/credit-cards/rewards failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
