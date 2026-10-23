import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { deleteGoal, GoalServiceError, goalUpdateSchema, updateGoal } from "@/lib/goal-service";

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
    const parsed = goalUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const goal = await updateGoal({ ...parsed.data, userId: user.id, goalId: id, actor: user });
    return NextResponse.json({ data: goal });
  } catch (err) {
    if (err instanceof GoalServiceError && err.code === "GOAL_NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.error({ err }, "PATCH /api/goals/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await deleteGoal(user.id, id, user);
    return NextResponse.json({ data: { message: "Goal deleted" } });
  } catch (err) {
    if (err instanceof GoalServiceError && err.code === "GOAL_NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.error({ err }, "DELETE /api/goals/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
