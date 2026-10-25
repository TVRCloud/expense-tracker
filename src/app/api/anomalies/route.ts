import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { anomalyListQuerySchema, listAnomalies } from "@/lib/anomaly-service";

// GET /api/anomalies?status=open|dismissed|confirmed_mine|reported|all&limit&skip — unusual-spend alerts.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const sp = new URL(req.url).searchParams;
    const parsed = anomalyListQuerySchema.safeParse({
      ...(sp.get("status") !== null ? { status: sp.get("status") } : {}),
      ...(sp.get("limit") !== null ? { limit: sp.get("limit") } : {}),
      ...(sp.get("skip") !== null ? { skip: sp.get("skip") } : {}),
    });
    if (!parsed.success) return NextResponse.json({ error: "status, limit or skip is invalid" }, { status: 400 });
    return NextResponse.json({ data: await listAnomalies(user.id, parsed.data) });
  } catch (err) {
    logger.error({ err }, "GET /api/anomalies failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
