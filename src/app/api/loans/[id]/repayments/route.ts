import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createRepayment, listRepayments, LoanServiceError, repaymentCreateSchema } from "@/lib/loan-service";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const repayments = await listRepayments(user.id, id);
    return NextResponse.json({ data: repayments });
  } catch (err) {
    if (err instanceof LoanServiceError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
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
    const parsed = repaymentCreateSchema.safeParse(body);
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
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    logger.error({ err }, "POST /api/loans/[id]/repayments failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
