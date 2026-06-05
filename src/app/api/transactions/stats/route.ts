import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import { redis } from "@/lib/redis";
import logger from "@/lib/logger";
import { Types } from "mongoose";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

    const cacheKey = `stats:v2:${user.id}:${year}:${month}`;
    try {
      const cached = await redis?.get(cacheKey);
      if (cached) return NextResponse.json({ data: JSON.parse(cached) });
    } catch {
      // Redis unavailable — continue without cache
    }

    await connectDB();
    const userObjectId = new Types.ObjectId(user.id);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const [agg, catAgg] = await Promise.all([
      Transaction.aggregate([
        { $match: { user: userObjectId, date: { $gte: startDate, $lt: endDate } } },
        {
          $group: {
            _id: "$type",
            total: { $sum: "$amount" },
          },
        },
      ]),
      Transaction.aggregate([
        { $match: { user: userObjectId, type: "expense", date: { $gte: startDate, $lt: endDate } } },
        { $group: { _id: "$category", total: { $sum: "$amount" } } },
        { $sort: { total: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, category: "$_id", total: 1 } },
      ]),
    ]);

    const income = agg.find((a) => a._id === "income")?.total ?? 0;
    const expense = agg.find((a) => a._id === "expense")?.total ?? 0;
    const daysInMonth = new Date(year, month, 0).getDate();

    const stats = {
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

    return NextResponse.json({ data: stats });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/stats failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
