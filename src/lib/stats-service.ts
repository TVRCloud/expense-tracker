import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { activityDateAddFields } from "@/lib/transaction-activity";
import { redis } from "@/lib/redis";

// Shared monthly-stats aggregation, used by GET /api/transactions/stats
// (browser) and GET /api/integrations/summary (n8n) so both surfaces see the
// exact same numbers from one aggregation pipeline. Reuses the existing
// Redis cache key/TTL — no new cache namespace is introduced.

export type MonthlyStats = {
  income: number;
  expense: number;
  net: number;
  byCategory: Array<{ category: string; total: number }>;
  dailyAverage: number;
};

export function statsCacheKey(userId: string, year: number, month: number) {
  return `stats:v2:${userId}:${year}:${month}`;
}

export async function getMonthlyStats(userId: string, year: number, month: number): Promise<MonthlyStats> {
  const cacheKey = statsCacheKey(userId, year, month);
  try {
    const cached = await redis?.get(cacheKey);
    if (cached) return JSON.parse(cached) as MonthlyStats;
  } catch {
    // Redis unavailable — continue without cache
  }

  await connectDB();
  const userObjectId = new Types.ObjectId(userId);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);

  // Only count recurring installments that have been explicitly marked paid.
  // Regular transactions (no recurringId) always count.
  const paidInstallmentsOnly = {
    $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
  };

  // The activity date is paidAt for paid installments, else date, so a row
  // can only be in this month if one of the two is. Narrowing on those
  // (both indexed) first means scanning this month's rows instead of the
  // user's whole history; the exact test still runs after $addFields.
  // One pass computes both the type totals and the category breakdown.
  const inRange = { $gte: startDate, $lt: endDate };
  const [result] = await Transaction.aggregate([
    {
      $match: {
        user: userObjectId,
        isDeleted: { $ne: true },
        ...paidInstallmentsOnly,
        $or: [{ date: inRange }, { paidAt: inRange }],
      },
    },
    { $addFields: activityDateAddFields() },
    { $match: { activityDate: inRange } },
    {
      $facet: {
        byType: [{ $group: { _id: "$type", total: { $sum: "$amount" } } }],
        byCategory: [
          { $match: { type: "expense" } },
          { $group: { _id: "$category", total: { $sum: "$amount" } } },
          { $sort: { total: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, category: "$_id", total: 1 } },
        ],
      },
    },
  ]);
  const agg: Array<{ _id: string; total: number }> = result?.byType ?? [];
  const catAgg: Array<{ category: string; total: number }> = result?.byCategory ?? [];

  const income = agg.find((a) => a._id === "income")?.total ?? 0;
  const expense = agg.find((a) => a._id === "expense")?.total ?? 0;
  const daysInMonth = new Date(year, month, 0).getDate();

  const stats: MonthlyStats = {
    income,
    expense,
    net: income - expense,
    byCategory: catAgg,
    dailyAverage: Math.round(expense / daysInMonth),
  };

  try {
    await redis?.setex(cacheKey, 300, JSON.stringify(stats));
  } catch {
    // Redis unavailable
  }

  return stats;
}
