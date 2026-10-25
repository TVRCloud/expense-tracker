import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { assignEnvelopes, envelopeAssignSchema, getEnvelopePlan } from "@/lib/envelope-service";
import { browserEnvelopeWrite } from "@/lib/envelope-browser";

// GET /api/envelopes?month=YYYY-MM — the month's envelope plan; same report as
// GET /api/integrations/envelopes.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const month = req.nextUrl.searchParams.get("month");
    if (month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: "month must look like 2026-10" }, { status: 400 });
    }
    return NextResponse.json({ data: await getEnvelopePlan(user.id, month ?? undefined) });
  } catch (err) {
    logger.error({ err }, "GET /api/envelopes failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/envelopes — { month, income?, assign?, remove? }.
export async function PUT(req: NextRequest) {
  return browserEnvelopeWrite(req, "PUT /api/envelopes", envelopeAssignSchema, (input, user) => assignEnvelopes(user.id, input));
}
