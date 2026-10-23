import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { activityDateAddFields, getTransactionActivityDate } from "@/lib/transaction-activity";
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

export type MonthRef = { month: number; year: number };
export type MonthHistory = MonthRef & { stats: MonthlyStats };

// "2026-9,2026-10" -> month refs. Same rules as GET /api/transactions/stats/range.
export function parseMonthList(raw: string | null): MonthRef[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => {
      const [yearRaw, monthRaw] = part.split("-");
      return { year: Number(yearRaw), month: Number(monthRaw) };
    })
    .filter(
      ({ month, year }) =>
        Number.isInteger(month) && Number.isInteger(year) && month >= 1 && month <= 12 && year >= 2020
    )
    .slice(0, 24);
}

function emptyMonthlyStats(): MonthlyStats {
  return { income: 0, expense: 0, net: 0, byCategory: [], dailyAverage: 0 };
}

// Several months in one query, for the analytics history. Shared by
// GET /api/transactions/stats/range (browser) and GET /api/integrations/stats.
export async function getRangeStats(userId: string, months: MonthRef[]): Promise<MonthHistory[]> {
  if (months.length === 0) return [];
  const key = (year: number, month: number) => `${year}-${month}`;

  const sorted = [...months].sort(
    (a, b) => new Date(a.year, a.month - 1, 1).getTime() - new Date(b.year, b.month - 1, 1).getTime()
  );
  const start = new Date(sorted[0].year, sorted[0].month - 1, 1);
  const last = sorted[sorted.length - 1];
  const end = new Date(last.year, last.month, 1);
  const monthSet = new Set(months.map(({ year, month }) => key(year, month)));

  await connectDB();
  const rows = await Transaction.find({
    user: new Types.ObjectId(userId),
    isDeleted: { $ne: true },
    $or: [{ date: { $gte: start, $lt: end } }, { paidAt: { $gte: start, $lt: end } }],
    // Only count recurring installments that have been explicitly marked paid.
    // Regular transactions (no recurringId) always count.
    $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
  })
    .select("type amount category date recurringId installmentStatus paidAt")
    .lean<
      Array<{
        type: "income" | "expense" | "transfer";
        amount: number;
        category: string;
        date: Date;
        recurringId?: unknown;
        installmentStatus?: string;
        paidAt?: Date;
      }>
    >();

  const statsByMonth = new Map<string, MonthlyStats>();
  const categoryTotals = new Map<string, Map<string, number>>();
  for (const { year, month } of months) {
    statsByMonth.set(key(year, month), emptyMonthlyStats());
    categoryTotals.set(key(year, month), new Map());
  }

  for (const tx of rows) {
    const date = getTransactionActivityDate(tx);
    if (date < start || date >= end) continue;
    const k = key(date.getFullYear(), date.getMonth() + 1);
    if (!monthSet.has(k)) continue;
    const stats = statsByMonth.get(k);
    if (!stats) continue;

    if (tx.type === "income") {
      stats.income += tx.amount;
    } else if (tx.type === "expense") {
      stats.expense += tx.amount;
      const categoryMap = categoryTotals.get(k);
      if (categoryMap) categoryMap.set(tx.category, (categoryMap.get(tx.category) ?? 0) + tx.amount);
    }
    stats.net = stats.income - stats.expense;
  }

  return months.map(({ month, year }) => {
    const k = key(year, month);
    const stats = statsByMonth.get(k) ?? emptyMonthlyStats();
    const categoryMap = categoryTotals.get(k) ?? new Map<string, number>();
    const daysInMonth = new Date(year, month, 0).getDate();
    stats.byCategory = Array.from(categoryMap.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    stats.dailyAverage = Math.round(stats.expense / daysInMonth);
    return { year, month, stats };
  });
}

// Income and expense per day of one month, for a daily trend chart. Same
// activity-date and paid-installment rules as getMonthlyStats, so the days add
// up to its income and expense. Days with no activity are included as zeros.
export async function getDailyTotals(
  userId: string,
  year: number,
  month: number
): Promise<Array<{ day: number; income: number; expense: number }>> {
  await connectDB();
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);
  const inRange = { $gte: startDate, $lt: endDate };

  const rows: Array<{ _id: { day: number; type: string }; total: number }> = await Transaction.aggregate([
    {
      $match: {
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        type: { $in: ["income", "expense"] },
        $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
        $or: [{ date: inRange }, { paidAt: inRange }],
      },
    },
    { $addFields: activityDateAddFields() },
    { $match: { activityDate: inRange } },
    { $group: { _id: { day: { $dayOfMonth: "$activityDate" }, type: "$type" }, total: { $sum: "$amount" } } },
  ]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, income: 0, expense: 0 }));
  for (const r of rows) {
    const d = days[r._id.day - 1];
    if (!d) continue;
    if (r._id.type === "income") d.income += r.total;
    else d.expense += r.total;
  }
  return days;
}
