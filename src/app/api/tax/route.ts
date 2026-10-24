import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getTaxSummary } from "@/lib/tax-service";
import { parseFy } from "@/lib/tax-year";

// GET /api/tax?fy=2025 — the 2025-26 financial year (1 April to 31 March in the
// user's time zone). Without `fy`, the current year. Same report as
// GET /api/integrations/tax.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const raw = req.nextUrl.searchParams.get("fy");
    const fy = raw === null ? undefined : parseFy(raw);
    if (fy === null) return NextResponse.json({ error: "fy must be a year such as 2025" }, { status: 400 });
    return NextResponse.json({ data: await getTaxSummary(user.id, fy) });
  } catch (err) {
    logger.error({ err }, "GET /api/tax failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
