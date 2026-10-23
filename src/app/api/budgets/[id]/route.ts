import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { BudgetServiceError, budgetUpdateSchema, deleteBudget, updateBudget } from "@/lib/budget-service";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const budget = await Budget.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!budget) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: budget });
  } catch (err) {
    logger.error({ err }, "GET /api/budgets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await req.json();
    const parsed = budgetUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const budget = await updateBudget({ ...parsed.data, userId: user.id, budgetId: id, actor: user });
    return NextResponse.json({ data: budget });
  } catch (err) {
    if (err instanceof BudgetServiceError && err.code === "BUDGET_NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.error({ err }, "PATCH /api/budgets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await deleteBudget(user.id, id, user);
    return NextResponse.json({ data: { message: "Budget deleted" } });
  } catch (err) {
    if (err instanceof BudgetServiceError && err.code === "BUDGET_NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.error({ err }, "DELETE /api/budgets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
