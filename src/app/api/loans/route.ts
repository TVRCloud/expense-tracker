import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createLoan, listLoans, LoanServiceError, loanCreateSchema } from "@/lib/loan-service";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const loans = await listLoans(user.id, {
      direction: searchParams.get("direction"),
      isSettled: searchParams.get("isSettled"),
    });
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
    const parsed = loanCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const loan = await createLoan({ ...parsed.data, userId: user.id, actor: user });
    return NextResponse.json({ data: loan }, { status: 201 });
  } catch (err) {
    if (err instanceof LoanServiceError && err.code === "ACCOUNT_NOT_FOUND") {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    logger.error({ err }, "POST /api/loans failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
