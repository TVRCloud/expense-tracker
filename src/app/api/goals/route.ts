import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  targetAmount: z.number().int().positive(),
  savedAmount: z.number().int().min(0).default(0),
  targetDate: z.string().optional(),
  linkedAccount: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const goals = await Goal.find({ user: user.id }).sort({ createdAt: -1 }).lean();
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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const goal = await Goal.create({
      ...parsed.data,
      user: user.id,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined,
    });

    return NextResponse.json({ data: goal }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/goals failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
