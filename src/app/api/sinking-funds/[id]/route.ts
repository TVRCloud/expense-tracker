import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import {
  deleteSinkingFund,
  getSinkingFund,
  SinkingFundError,
  sinkingFundUpdateSchema,
  updateSinkingFund,
} from "@/lib/sinking-fund-service";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    return NextResponse.json({ data: await getSinkingFund(user.id, id) });
  } catch (err) {
    if (err instanceof SinkingFundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "GET /api/sinking-funds/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const parsed = sinkingFundUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ data: await updateSinkingFund({ ...parsed.data, userId: user.id, fundId: id }) });
  } catch (err) {
    if (err instanceof SinkingFundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "PATCH /api/sinking-funds/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await deleteSinkingFund(user.id, id);
    return NextResponse.json({ data: { id, deleted: true } });
  } catch (err) {
    if (err instanceof SinkingFundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "DELETE /api/sinking-funds/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
