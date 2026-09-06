import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createGoal, goalCreateSchema } from "@/lib/goal-service";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const goals = await Goal.find({ user: user.id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ data: goals });
  } catch (err) {
    logger.error({ err }, "GET /api/goals failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = goalCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const goal = await createGoal({ ...parsed.data, userId: user.id, actor: user });
    return NextResponse.json({ data: goal }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/goals failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
