import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Loan from "@/models/Loan";
import Repayment from "@/models/Repayment";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { createRepayment, LoanServiceError } from "@/lib/loan-service";

const createSchema = z.object({
  amount: z.number().int().positive(),
  date: z.string(),
  note: z.string().optional(),
  accountId: z.string().optional(),
});

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();

    const loan = await Loan.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const repayments = await Repayment.find({ loan: id, user: user.id, isDeleted: { $ne: true } })
      .sort({ date: -1 })
      .lean();
    return NextResponse.json({ data: repayments });
  } catch (err) {
    logger.error({ err }, "GET /api/loans/[id]/repayments failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const { repayment, isSettled } = await createRepayment({
      loanId: id,
      userId: user.id,
      actor: user,
      amount: parsed.data.amount,
      date: new Date(parsed.data.date),
      note: parsed.data.note,
      accountId: parsed.data.accountId,
    });

    return NextResponse.json({ data: repayment, isSettled }, { status: 201 });
  } catch (err) {
    if (err instanceof LoanServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 404 });
    }
    logger.error({ err }, "POST /api/loans/[id]/repayments failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
