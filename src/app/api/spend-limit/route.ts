import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getSpendLimitStatus, spendLimitUpdateSchema, updateSpendLimit } from "@/lib/spend-limit";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await getSpendLimitStatus(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/spend-limit failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const parsed = spendLimitUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ data: await updateSpendLimit(user.id, parsed.data) });
  } catch (err) {
    logger.error({ err }, "PUT /api/spend-limit failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
