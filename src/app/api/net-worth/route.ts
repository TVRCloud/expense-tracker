import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getNetWorth, NET_WORTH_RANGES, type NetWorthRange } from "@/lib/net-worth";

// GET /api/net-worth?range=30d|90d|1y|all (default 90d) — what the user owns
// minus what they owe, with the rows behind it and the trend. Same report as
// GET /api/integrations/net-worth. Reading it also stores today's point.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const raw = new URL(req.url).searchParams.get("range");
    const range: NetWorthRange = NET_WORTH_RANGES.includes(raw as NetWorthRange) ? (raw as NetWorthRange) : "90d";
    return NextResponse.json({ data: await getNetWorth(user.id, range) });
  } catch (err) {
    logger.error({ err }, "GET /api/net-worth failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
