import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import Transaction from "@/models/Transaction";

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
