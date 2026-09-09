import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { appendLedgerBlock } from "@/lib/ledger";
import { checkGoalCompletion } from "@/lib/goal-service";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  targetAmount: z.number().int().positive().optional(),
  savedAmount: z.number().int().min(0).optional(),
  targetDate: z.string().optional(),
  icon: z.string().optional(),
  isCompleted: z.boolean().optional(),
  roundUpEnabled: z.boolean().optional(),
  roundUpTo: z.number().int().positive().optional(),
});

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const goal = await Goal.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: goal });
  } catch (err) {
    logger.error({ err }, "GET /api/goals/[id] failed");
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

    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.targetDate) update.targetDate = new Date(parsed.data.targetDate);

    await connectDB();
    const before = await Goal.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Only one goal can have round-up active at a time — enabling it here
    // disables it everywhere else for this user first.
    if (parsed.data.roundUpEnabled === true) {
      await Goal.updateMany({ user: user.id, _id: { $ne: id } }, { $set: { roundUpEnabled: false } });
    }

    const goal = await Goal.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: update },
      { new: true }
    ).lean<{ _id: unknown; savedAmount: number; targetAmount: number; name: string; isCompleted: boolean }>();

    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "goal",
      entityId: id,
      action: "update",
      before,
      after: goal,
      actor: user,
    });

    await checkGoalCompletion(user.id, goal, user);

    return NextResponse.json({ data: goal });
  } catch (err) {
    logger.error({ err }, "PATCH /api/goals/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const before = await Goal.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const goal = await Goal.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } },
      { new: true }
    ).lean();
    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "goal",
      entityId: id,
      action: "delete",
      before,
      after: goal,
      actor: user,
    });
    return NextResponse.json({ data: { message: "Goal deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/goals/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
