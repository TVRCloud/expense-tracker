import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Loan from "@/models/Loan";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const createSchema = z.object({
  direction: z.enum(["given", "received"]),
  counterparty: z.string().min(1).max(100),
  principalAmount: z.number().int().positive(),
  currency: z.string().default("USD"),
  interestRate: z.number().min(0).max(100).default(0),
  startDate: z.string(),
  dueDate: z.string().optional(),
  note: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const direction = searchParams.get("direction");
    const isSettled = searchParams.get("isSettled");

    const query: Record<string, unknown> = { user: user.id };
    if (direction) query.direction = direction;
    if (isSettled !== null) query.isSettled = isSettled === "true";

    await connectDB();
    const loans = await Loan.find(query).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ data: loans });
  } catch (err) {
    logger.error({ err }, "GET /api/loans failed");
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
    const loan = await Loan.create({
      ...parsed.data,
      user: user.id,
      remainingAmount: parsed.data.principalAmount,
      startDate: new Date(parsed.data.startDate),
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    });

    return NextResponse.json({ data: loan }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/loans failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
