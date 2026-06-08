import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { Types } from "mongoose";
import { redis } from "@/lib/redis";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import { checkBudgetAlert } from "@/lib/budget-alert";

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
  recurrenceCount: z.number().int().min(1).max(3650).optional(),
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

async function invalidateStatsCacheMany(userId: string, dates: Date[]) {
  if (!redis) return;
  const keys = new Set<string>();
  for (const d of dates) {
    keys.add(`stats:v2:${userId}:${d.getFullYear()}:${d.getMonth() + 1}`);
  }
  try {
    await Promise.all([...keys].map(k => redis!.del(k)));
  } catch {
    // Redis unavailable
  }
}

function computeInstallmentDates(
  startDate: Date,
  frequency: string,
  interval: number,
  count: number
): Date[] {
  const adder: (d: Date, n: number) => Date =
    frequency === "daily" ? (d, n) => addDays(d, n) :
    frequency === "weekly" ? (d, n) => addWeeks(d, n) :
    frequency === "yearly" ? (d, n) => addYears(d, n) :
    (d, n) => addMonths(d, n); // monthly default

  return Array.from({ length: count }, (_, i) => adder(startDate, interval * i));
}

function defaultRecurringCount(frequency: string): number {
  if (frequency === "daily") return 365;
  if (frequency === "weekly") return 260;
  if (frequency === "yearly") return 30;
  return 120;
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

    // Exclude unpaid recurring installments from the main list.
    // They live in /transactions/recurring/[id] instead.
    query.$nor = [
      {
        recurringId: { $exists: true },
        installmentStatus: { $nin: ["paid"] },
      },
    ];

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

    const account = await Account.findOne({ _id: accountId, user: user.id });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const startDate = new Date(rest.date);
    // ── Bulk-create recurring installments ──────────────────────────────────
    const installmentCount = rest.isRecurring && rest.recurrenceFrequency
      ? (rest.recurrenceCount ?? defaultRecurringCount(rest.recurrenceFrequency))
      : 0;
    if (rest.isRecurring && installmentCount > 1 && rest.recurrenceFrequency) {
      const recurringId = new Types.ObjectId();
      const interval = rest.recurrenceInterval ?? 1;
      const dates = computeInstallmentDates(startDate, rest.recurrenceFrequency, interval, installmentCount);

      // No balance update at creation — installments only affect balance when marked paid
      const docs = dates.map((d, i) => ({
        ...rest,
        recurrenceCount: installmentCount,
        account: accountId,
        user: user.id,
        date: d,
        recurringId,
        installmentIndex: i,
        installmentStatus: "upcoming" as const,
        recurrenceInterval: interval,
        recurrenceEndDate: rest.recurrenceEndDate ? new Date(rest.recurrenceEndDate) : undefined,
        ...(transferToId ? { transferTo: transferToId } : {}),
      }));

      const inserted = await Transaction.insertMany(docs);
      await invalidateStatsCacheMany(user.id, dates);

      logger.info({ userId: user.id, recurringId: recurringId.toString(), count: docs.length }, "Recurring series created");
      return NextResponse.json(
        { data: inserted[0], seriesId: recurringId.toString(), count: docs.length },
        { status: 201 }
      );
    }

    // ── Single transaction (non-recurring or recurring count = 1) ───────────
    const balanceDelta = rest.type === "income" ? rest.amount : -rest.amount;
    account.balance += balanceDelta;
    await account.save();

    if (rest.type === "transfer" && transferToId) {
      await Account.findOneAndUpdate(
        { _id: transferToId, user: user.id },
        { $inc: { balance: rest.amount } }
      );
    }

    const transaction = await Transaction.create({
      ...rest,
      account: accountId,
      user: user.id,
      date: startDate,
      recurrenceInterval: rest.isRecurring ? (rest.recurrenceInterval ?? 1) : undefined,
      recurrenceEndDate: rest.recurrenceEndDate ? new Date(rest.recurrenceEndDate) : undefined,
      ...(transferToId ? { transferTo: transferToId } : {}),
    });
    await invalidateStatsCache(user.id, startDate);

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
