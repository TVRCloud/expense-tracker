import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { appendLedgerBlock } from "@/lib/ledger";

const updateSchema = z.object({
  limitAmount: z.number().int().positive().optional(),
  alertAt: z.number().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const budget = await Budget.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!budget) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: budget });
  } catch (err) {
    logger.error({ err }, "GET /api/budgets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const before = await Budget.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const budget = await Budget.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: parsed.data },
      { new: true }
    ).lean();

    if (!budget) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "budget",
      entityId: id,
      action: "update",
      before,
      after: budget,
      actor: user,
    });
    return NextResponse.json({ data: budget });
  } catch (err) {
    logger.error({ err }, "PATCH /api/budgets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const before = await Budget.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const budget = await Budget.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } },
      { new: true }
    ).lean();
    if (!budget) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "budget",
      entityId: id,
      action: "delete",
      before,
      after: budget,
      actor: user,
    });
    return NextResponse.json({ data: { message: "Budget deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/budgets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
