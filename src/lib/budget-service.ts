import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import Transaction from "@/models/Transaction";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";

// Shared budget-listing + spend calculation, used by GET /api/budgets
// (browser) and GET /api/integrations/budgets (n8n) so both report the same
// numbers from one aggregation pipeline.
export async function listBudgetsWithSpend(userId: string, year: number, month: number) {
  await connectDB();
  const userObjectId = new Types.ObjectId(userId);
  const budgets = await Budget.find({ user: userId, month, year, isDeleted: { $ne: true } }).lean();

  return Promise.all(
    budgets.map(async (b) => {
      const spent = await Transaction.aggregate([
        {
          $match: {
            user: userObjectId,
            isDeleted: { $ne: true },
            category: b.category,
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
      return { ...b, spent: spent[0]?.total ?? 0 };
    })
  );
}

export const budgetCreateSchema = z.object({
  category: z.string().min(1),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  limitAmount: z.number().int().positive(),
  alertAt: z.number().min(1).max(100).default(80),
});

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
