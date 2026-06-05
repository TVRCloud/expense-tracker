import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import Notification from "@/models/Notification";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  targetAmount: z.number().int().positive().optional(),
  savedAmount: z.number().int().min(0).optional(),
  targetDate: z.string().optional(),
  isCompleted: z.boolean().optional(),
});

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const goal = await Goal.findOne({ _id: id, user: user.id }).lean();
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
    const goal = await Goal.findOneAndUpdate(
      { _id: id, user: user.id },
      { $set: update },
      { new: true }
    ).lean<{ savedAmount: number; targetAmount: number; name: string; isCompleted: boolean }>();

    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Fire goal_reached notification
    if (!goal.isCompleted && goal.savedAmount >= goal.targetAmount) {
      void Goal.findByIdAndUpdate(id, { $set: { isCompleted: true } });
      void Notification.create({
        user: user.id,
        type: "goal_reached",
        title: "Goal reached! 🎉",
        body: `Congratulations! You've reached your "${goal.name}" goal.`,
        meta: { goalId: id },
      });
    }

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
    const goal = await Goal.findOneAndDelete({ _id: id, user: user.id });
    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: { message: "Goal deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/goals/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
