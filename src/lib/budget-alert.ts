import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import Transaction from "@/models/Transaction";
import Notification from "@/models/Notification";
import logger from "@/lib/logger";
import { activityDateAddFields } from "@/lib/transaction-activity";

export async function checkBudgetAlert(userId: string, category: string, _amount: number, activityDate = new Date()) {
  try {
    await connectDB();
    const month = activityDate.getMonth() + 1;
    const year = activityDate.getFullYear();

    const userObjectId = new Types.ObjectId(userId);
    const budget = await Budget.findOne({
      user: userId,
      category,
      month,
      year,
      isActive: true,
      isDeleted: { $ne: true },
    }).lean<{
      _id: { toString(): string };
      limitAmount: number;
      alertAt: number;
    }>();
    if (!budget) return;

    const spent = await Transaction.aggregate([
      {
        $match: {
          user: userObjectId,
          isDeleted: { $ne: true },
          category,
          type: "expense",
          // Only count paid installments toward budget
          $nor: [{
            recurringId: { $exists: true },
            installmentStatus: { $nin: ["paid"] },
          }],
        },
      },
      { $addFields: activityDateAddFields() },
      {
        $match: {
          activityDate: {
            $gte: new Date(year, month - 1, 1),
            $lt: new Date(year, month, 1),
          },
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
