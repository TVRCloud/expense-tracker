import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import Transaction from "@/models/Transaction";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import { budgetCreateSchema } from "@/features/budgets/schemas/budget.schema";
import { z } from "zod";

export { budgetCreateSchema };

// Shared budget-listing + spend calculation, used by GET /api/budgets
// (browser) and GET /api/integrations/budgets (n8n) so both report the same
// numbers from one aggregation pipeline.
async function categorySpend(userObjectId: Types.ObjectId, category: string, year: number, month: number) {
  const spent = await Transaction.aggregate([
    {
      $match: {
        user: userObjectId,
        isDeleted: { $ne: true },
        category,
        type: "expense",
        date: {
          $gte: new Date(year, month - 1, 1),
          $lt: new Date(year, month, 1),
        },
        $nor: [
          {
            recurringId: { $exists: true },
            installmentStatus: { $nin: ["paid"] },
          },
        ],
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return spent[0]?.total ?? 0;
}

export async function listBudgetsWithSpend(userId: string, year: number, month: number) {
  await connectDB();
  const userObjectId = new Types.ObjectId(userId);
  const budgets = await Budget.find({ user: userId, month, year, isDeleted: { $ne: true } }).lean();

  return Promise.all(
    budgets.map(async (b) => {
      const spent = await categorySpend(userObjectId, b.category, year, month);

      // `limitAmount` stays exactly what the user set — the source of
      // truth. Rollover computes a separate `effectiveLimit` that adds the
      // previous month's unspent amount for the same category, so a
      // rollover-enabled budget's carried-forward headroom is always
      // derived, never baked into the stored limit.
      let effectiveLimit = b.limitAmount;
      if (b.rollover) {
        const prevDate = new Date(year, month - 2, 1);
        const prevMonth = prevDate.getMonth() + 1;
        const prevYear = prevDate.getFullYear();
        const prevBudget = await Budget.findOne({
          user: userId, category: b.category, month: prevMonth, year: prevYear, isDeleted: { $ne: true },
        }).lean();
        if (prevBudget) {
          const prevSpent = await categorySpend(userObjectId, b.category, prevYear, prevMonth);
          const unspent = Math.max(prevBudget.limitAmount - prevSpent, 0);
          effectiveLimit = b.limitAmount + unspent;
        }
      }

      return { ...b, spent, effectiveLimit };
    })
  );
}

export type CreateBudgetInput = z.infer<typeof budgetCreateSchema> & { userId: string; actor: AuthUser };

export class BudgetServiceError extends Error {
  code: "BUDGET_EXISTS";
  constructor(code: "BUDGET_EXISTS", message: string) {
    super(message);
    this.code = code;
    this.name = "BudgetServiceError";
  }
}

// Shared with POST /api/budgets (browser) and the integration route.
export async function createBudget(input: CreateBudgetInput) {
  const { userId, actor, ...rest } = input;
  await connectDB();

  const existing = await Budget.findOne({
    user: userId,
    category: rest.category,
    month: rest.month,
    year: rest.year,
  });
  if (existing && existing.isDeleted !== true) {
    throw new BudgetServiceError("BUDGET_EXISTS", "Budget already exists for this category and period");
  }

  if (existing?.isDeleted === true) {
    const before = existing.toObject();
    existing.set({ ...rest, isDeleted: false, deletedAt: undefined, deletedBy: undefined });
    await existing.save();
    await appendLedgerBlock({
      userId,
      scope: "budget",
      entityId: existing._id.toString(),
      action: "restore",
      before,
      after: existing,
      actor,
    });
    return existing;
  }

  const budget = await Budget.create({ ...rest, user: userId });
  await appendLedgerBlock({
    userId,
    scope: "budget",
    entityId: budget._id.toString(),
    action: "create",
    after: budget,
    actor,
  });
  return budget;
}
