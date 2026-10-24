import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { contributeToSinkingFund, SinkingFundError, sinkingFundContributeSchema } from "@/lib/sinking-fund-service";

type Params = Promise<{ id: string }>;

// Positive amount puts money in, negative takes it out (the balance stops at 0).
export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const parsed = sinkingFundContributeSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({
      data: await contributeToSinkingFund({ userId: user.id, fundId: id, amount: parsed.data.amount }),
    });
  } catch (err) {
    if (err instanceof SinkingFundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "POST /api/sinking-funds/[id]/contribute failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
