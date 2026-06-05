import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import Budget from "@/models/Budget";
import Notification from "@/models/Notification";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { Types } from "mongoose";
import { redis } from "@/lib/redis";

const createSchema = z.object({
  accountId: z.string(),
  type: z.enum(["income", "expense", "transfer"]),
  amount: z.number().int().positive(),
  currency: z.string().default("USD"),
  category: z.string().min(1),
  subcategory: z.string().optional(),
  description: z.string().optional(),
  note: z.string().optional(),
  date: z.string(),
  tags: z.array(z.string()).default([]),
  transferToId: z.string().optional(),
  isRecurring: z.boolean().default(false),
  recurrenceFrequency: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  recurrenceInterval: z.number().int().min(1).max(60).optional(),
  recurrenceCount: z.number().int().min(1).max(600).optional(),
  recurrenceEndDate: z.string().optional(),
  recurrenceLabel: z.string().max(100).optional(),
});

async function invalidateStatsCache(userId: string, date: Date) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  try {
    await redis?.del(`stats:v2:${userId}:${year}:${month}`);
  } catch {
    // Redis unavailable
  }
}

async function checkBudgetAlert(userId: string, category: string, amount: number) {
  try {
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
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalSpent = (spent[0]?.total ?? 0) + amount;
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

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const skip = parseInt(searchParams.get("skip") ?? "0", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);
    const type = searchParams.get("type");
    const category = searchParams.get("category");
    const accountId = searchParams.get("accountId");
    const search = searchParams.get("search");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const query: Record<string, unknown> = { user: user.id };
    if (type) query.type = type;
    if (category) query.category = category;
    if (accountId) query.account = accountId;
    if (search) query.$text = { $search: search };
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) (query.date as Record<string, unknown>).$gte = new Date(dateFrom);
      if (dateTo) (query.date as Record<string, unknown>).$lte = new Date(dateTo);
    }

    await connectDB();
    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(query),
    ]);

    return NextResponse.json({ data: transactions, total, skip, limit });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const { accountId, transferToId, ...rest } = parsed.data;
    await connectDB();

    // Update account balance
    const balanceDelta = rest.type === "income" ? rest.amount : -rest.amount;
    const account = await Account.findOneAndUpdate(
      { _id: accountId, user: user.id },
      { $inc: { balance: balanceDelta } },
      { new: true }
    );
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    if (rest.type === "transfer" && transferToId) {
      await Account.findOneAndUpdate(
        { _id: transferToId, user: user.id },
        { $inc: { balance: rest.amount } }
      );
    }

    const transactionDate = new Date(rest.date);
    const transaction = await Transaction.create({
      ...rest,
      account: accountId,
      user: user.id,
      date: transactionDate,
      recurrenceInterval: rest.isRecurring ? (rest.recurrenceInterval ?? 1) : undefined,
      recurrenceEndDate: rest.recurrenceEndDate ? new Date(rest.recurrenceEndDate) : undefined,
      ...(transferToId ? { transferTo: transferToId } : {}),
    });
    await invalidateStatsCache(user.id, transactionDate);

    // Check budget alert for expense transactions
    if (rest.type === "expense") {
      void checkBudgetAlert(user.id, rest.category, rest.amount);
    }

    logger.info({ userId: user.id, transactionId: transaction._id.toString() }, "Transaction created");
    return NextResponse.json({ data: transaction }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/transactions failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
