import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { type TransactionStats } from "@/types/models";

interface TransactionLike {
  type: "income" | "expense" | "transfer";
  amount: number;
  category: string;
  date: Date;
}

function parseMonths(raw: string | null): { month: number; year: number }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => {
      const [yearRaw, monthRaw] = part.split("-");
      return { year: Number(yearRaw), month: Number(monthRaw) };
    })
    .filter(({ month, year }) =>
      Number.isInteger(month) &&
      Number.isInteger(year) &&
      month >= 1 &&
      month <= 12 &&
      year >= 2020
    )
    .slice(0, 24);
}

function monthKey(year: number, month: number) {
  return `${year}-${month}`;
}

function emptyStats(): TransactionStats {
  return {
    income: 0,
    expense: 0,
    net: 0,
    byCategory: [],
    dailyAverage: 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const months = parseMonths(searchParams.get("months"));
    if (months.length === 0) {
      return NextResponse.json({ error: "Provide months as YYYY-M,YYYY-M" }, { status: 400 });
    }

    const sorted = [...months].sort((a, b) => (
      new Date(a.year, a.month - 1, 1).getTime() - new Date(b.year, b.month - 1, 1).getTime()
    ));
    const start = new Date(sorted[0].year, sorted[0].month - 1, 1);
    const last = sorted[sorted.length - 1];
    const end = new Date(last.year, last.month, 1);
    const monthSet = new Set(months.map(({ year, month }) => monthKey(year, month)));

    await connectDB();
    const rows = await Transaction.find({
      user: new Types.ObjectId(user.id),
      date: { $gte: start, $lt: end },
      // Only count recurring installments that have been explicitly marked paid.
      // Regular transactions (no recurringId) always count.
      $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
    })
      .select("type amount category date")
      .lean<TransactionLike[]>();

    const statsByMonth = new Map<string, TransactionStats>();
    const categoryTotals = new Map<string, Map<string, number>>();

    for (const { year, month } of months) {
      const key = monthKey(year, month);
      statsByMonth.set(key, emptyStats());
      categoryTotals.set(key, new Map());
    }

    for (const tx of rows) {
      const date = new Date(tx.date);
      const key = monthKey(date.getFullYear(), date.getMonth() + 1);
      if (!monthSet.has(key)) continue;

      const stats = statsByMonth.get(key);
      if (!stats) continue;

      if (tx.type === "income") {
        stats.income += tx.amount;
      } else if (tx.type === "expense") {
        stats.expense += tx.amount;
        const categoryMap = categoryTotals.get(key);
        if (categoryMap) categoryMap.set(tx.category, (categoryMap.get(tx.category) ?? 0) + tx.amount);
      }
      stats.net = stats.income - stats.expense;
    }

    const data = months.map(({ month, year }) => {
      const key = monthKey(year, month);
      const stats = statsByMonth.get(key) ?? emptyStats();
      const categoryMap = categoryTotals.get(key) ?? new Map<string, number>();
      const daysInMonth = new Date(year, month, 0).getDate();
      stats.byCategory = Array.from(categoryMap.entries())
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      stats.dailyAverage = Math.round(stats.expense / daysInMonth);
      return { year, month, stats };
    });

    return NextResponse.json({ data });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/stats/range failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
