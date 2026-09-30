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
// Spend per category per month for the given categories and months, in one
// aggregation (it used to be one query per budget, plus two more per
// rollover budget). Key: `${year}-${month}:${category}`.
async function spendByCategoryMonth(
  userObjectId: Types.ObjectId,
  categories: string[],
  months: Array<{ year: number; month: number }>
) {
  const out = new Map<string, number>();
  if (categories.length === 0 || months.length === 0) return out;
  const ranges = months.map(({ year, month }) => ({ $gte: new Date(year, month - 1, 1), $lt: new Date(year, month, 1) }));
  const rows = await Transaction.aggregate<{ _id: { b: number; category: string }; total: number }>([
    {
      $match: {
        user: userObjectId,
        isDeleted: { $ne: true },
        category: { $in: categories },
        type: "expense",
        $or: ranges.map((date) => ({ date })),
        $nor: [
          {
            recurringId: { $exists: true },
            installmentStatus: { $nin: ["paid"] },
          },
        ],
      },
    },
    // Month boundaries are local (new Date(y, m, 1) above), so bucket by the
    // same ranges rather than by $month, which would use UTC.
    {
      $addFields: {
        bucket: {
          $switch: {
            branches: ranges.map((r, i) => ({
              case: { $and: [{ $gte: ["$date", r.$gte] }, { $lt: ["$date", r.$lt] }] },
              then: i,
            })),
            default: -1,
          },
        },
      },
    },
    { $group: { _id: { b: "$bucket", category: "$category" }, total: { $sum: "$amount" } } },
  ]);
  for (const r of rows) {
    const m = months[r._id.b];
    if (m) out.set(`${m.year}-${m.month}:${r._id.category}`, r.total);
  }
  return out;
}

export async function listBudgetsWithSpend(userId: string, year: number, month: number) {
  await connectDB();
  const userObjectId = new Types.ObjectId(userId);
  const budgets = await Budget.find({ user: userId, month, year, isDeleted: { $ne: true } }).lean();
  if (budgets.length === 0) return [];

  const prevDate = new Date(year, month - 2, 1);
  const prevMonth = prevDate.getMonth() + 1;
  const prevYear = prevDate.getFullYear();
  const rolloverCategories = budgets.filter((b) => b.rollover).map((b) => b.category);

  const [prevBudgets, spend] = await Promise.all([
    rolloverCategories.length
      ? Budget.find({
          user: userId,
          category: { $in: rolloverCategories },
          month: prevMonth,
          year: prevYear,
          isDeleted: { $ne: true },
        }).lean()
      : Promise.resolve([]),
    spendByCategoryMonth(
      userObjectId,
      budgets.map((b) => b.category),
      rolloverCategories.length ? [{ year, month }, { year: prevYear, month: prevMonth }] : [{ year, month }]
    ),
  ]);
  const prevByCategory = new Map(prevBudgets.map((b) => [b.category, b]));

  return budgets.map((b) => {
    const spent = spend.get(`${year}-${month}:${b.category}`) ?? 0;

    // `limitAmount` stays exactly what the user set — the source of
    // truth. Rollover computes a separate `effectiveLimit` that adds the
    // previous month's unspent amount for the same category, so a
    // rollover-enabled budget's carried-forward headroom is always
    // derived, never baked into the stored limit.
    let effectiveLimit = b.limitAmount;
    const prevBudget = b.rollover ? prevByCategory.get(b.category) : undefined;
    if (prevBudget) {
      const prevSpent = spend.get(`${prevYear}-${prevMonth}:${b.category}`) ?? 0;
      effectiveLimit = b.limitAmount + Math.max(prevBudget.limitAmount - prevSpent, 0);
    }

    return { ...b, spent, effectiveLimit };
  });
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
