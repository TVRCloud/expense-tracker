import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { budgetCreateSchema, BudgetServiceError, createBudget, listBudgetsWithSpend } from "@/lib/budget-service";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

    const enriched = await listBudgetsWithSpend(user.id, year, month);

    return NextResponse.json({ data: enriched });
  } catch (err) {
    logger.error({ err }, "GET /api/budgets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = budgetCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const budget = await createBudget({ ...parsed.data, userId: user.id, actor: user });
    return NextResponse.json({ data: budget }, { status: 201 });
  } catch (err) {
    if (err instanceof BudgetServiceError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    logger.error({ err }, "POST /api/budgets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
