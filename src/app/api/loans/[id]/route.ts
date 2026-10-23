import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { deleteLoan, getLoan, LoanServiceError, loanUpdateSchema, updateLoan } from "@/lib/loan-service";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const loan = await getLoan(user.id, id);
    return NextResponse.json({ data: loan });
  } catch (err) {
    if (err instanceof LoanServiceError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
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
    const parsed = loanUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const loan = await updateLoan({ ...parsed.data, userId: user.id, loanId: id, actor: user });
    return NextResponse.json({ data: loan });
  } catch (err) {
    if (err instanceof LoanServiceError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.error({ err }, "PATCH /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await deleteLoan(user.id, id, user);
    return NextResponse.json({ data: { message: "Loan deleted" } });
  } catch (err) {
    if (err instanceof LoanServiceError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.error({ err }, "DELETE /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
