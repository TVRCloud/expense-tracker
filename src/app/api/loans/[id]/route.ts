import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Loan from "@/models/Loan";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const updateSchema = z.object({
  counterparty: z.string().min(1).max(100).optional(),
  dueDate: z.string().optional(),
  isSettled: z.boolean().optional(),
  note: z.string().optional(),
});

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const loan = await Loan.findOne({ _id: id, user: user.id }).lean();
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: loan });
  } catch (err) {
    logger.error({ err }, "GET /api/loans/[id] failed");
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
    if (parsed.data.dueDate) update.dueDate = new Date(parsed.data.dueDate);

    await connectDB();
    const loan = await Loan.findOneAndUpdate(
      { _id: id, user: user.id },
      { $set: update },
      { new: true }
    ).lean();

    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: loan });
  } catch (err) {
    logger.error({ err }, "PATCH /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const loan = await Loan.findOneAndDelete({ _id: id, user: user.id });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: { message: "Loan deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
