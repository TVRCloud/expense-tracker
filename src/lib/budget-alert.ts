import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import Transaction from "@/models/Transaction";
import Notification from "@/models/Notification";
import logger from "@/lib/logger";

export async function checkBudgetAlert(userId: string, category: string, _amount: number) {
  try {
    await connectDB();
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const userObjectId = new Types.ObjectId(userId);
    const budget = await Budget.findOne({ user: userId, category, month, year, isActive: true }).lean<{
      _id: { toString(): string };
      limitAmount: number;
      alertAt: number;
    }>();
    if (!budget) return;

    const spent = await Transaction.aggregate([
      {
        $match: {
          user: userObjectId,
          category,
          type: "expense",
          date: {
            $gte: new Date(year, month - 1, 1),
            $lt: new Date(year, month, 1),
          },
          // Only count paid installments toward budget
          $nor: [{
            recurringId: { $exists: true },
            installmentStatus: { $nin: ["paid"] },
          }],
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalSpent = spent[0]?.total ?? 0;
    const pct = (totalSpent / budget.limitAmount) * 100;

    if (pct >= budget.alertAt) {
      await Notification.create({
        user: userId,
        type: "budget_alert",
        title: `${category} budget alert`,
        body: `You've used ${Math.round(pct)}% of your ${category} budget.`,
        meta: { budgetId: budget._id.toString(), category, percent: pct },
      });
    }
  } catch (err) {
    logger.error({ err }, "Budget alert check failed");
  }
}
