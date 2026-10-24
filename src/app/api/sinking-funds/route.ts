import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createSinkingFund, listSinkingFunds, sinkingFundCreateSchema } from "@/lib/sinking-fund-service";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await listSinkingFunds(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/sinking-funds failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const parsed = sinkingFundCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const fund = await createSinkingFund({ ...parsed.data, userId: user.id });
    return NextResponse.json({ data: fund }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/sinking-funds failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
