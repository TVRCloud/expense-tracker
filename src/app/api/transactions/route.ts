import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { type PipelineStage, Types } from "mongoose";
import { redis } from "@/lib/redis";
import { checkBudgetAlert } from "@/lib/budget-alert";
import { computeInstallmentDates, OPEN_ENDED_WINDOW } from "@/lib/recurrence";
import { appendLedgerBlock } from "@/lib/ledger";
import { activityDateAddFields } from "@/lib/transaction-activity";
import { getIO } from "@/lib/io";

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
}).superRefine((data, ctx) => {
  if (!Types.ObjectId.isValid(data.accountId)) {
    ctx.addIssue({ code: "custom", path: ["accountId"], message: "Invalid account" });
  }
  if (data.transferToId && !Types.ObjectId.isValid(data.transferToId)) {
    ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Invalid transfer account" });
  }
  if (data.type === "transfer" && !data.transferToId) {
    ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Transfer destination is required" });
  }
  if (data.type !== "transfer" && data.transferToId) {
    ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Transfer destination is only allowed for transfers" });
  }
  if (data.type === "transfer" && data.transferToId === data.accountId) {
    ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Transfer destination must be different" });
  }
  if (data.type === "transfer" && data.isRecurring) {
    ctx.addIssue({ code: "custom", path: ["isRecurring"], message: "Recurring transfers are not supported" });
  }
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

function isValidObjectId(value: string | null) {
  return !value || Types.ObjectId.isValid(value);
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
    const hideFuture = searchParams.get("hideFuture") === "true";
    const includeUnpaidRecurring = searchParams.get("includeUnpaidRecurring") === "true";

    if (!isValidObjectId(accountId)) {
      return NextResponse.json({ error: "Invalid account" }, { status: 400 });
    }

    const query: Record<string, unknown> = { user: user.id, isDeleted: { $ne: true } };
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
    if (!includeUnpaidRecurring) {
      query.$nor = [
        {
          recurringId: { $exists: true },
          installmentStatus: { $nin: ["paid"] },
        },
      ];
    }

    await connectDB();
    if (hideFuture) {
      const now = new Date();
      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 59, 999);
      const visibilityFilter = {
        $or: [
          {
            recurringId: { $exists: false },
            date: { $lte: endOfToday },
          },
          {
            recurringId: { $exists: true },
            installmentStatus: "paid",
            paidAt: { $exists: true, $lte: now },
          },
          {
            recurringId: { $exists: true },
            installmentStatus: "paid",
            paidAt: { $exists: false },
            date: { $lte: endOfToday },
          },
        ],
      };
      const aggregateQuery = {
        ...query,
        user: new Types.ObjectId(user.id),
        ...(accountId ? { account: new Types.ObjectId(accountId) } : {}),
        $and: [...((query.$and as Record<string, unknown>[]) ?? []), visibilityFilter],
      };
      const pipeline: PipelineStage[] = [
        { $match: aggregateQuery },
        {
          $addFields: {
            ...activityDateAddFields(),
          },
        },
        {
          $facet: {
            data: [
              { $sort: { activityDate: -1, date: -1, _id: -1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: { activityDate: 0 } },
            ],
            total: [{ $count: "count" }],
          },
        },
      ];
      const [result] = await Transaction.aggregate(pipeline);
      return NextResponse.json({
        data: result?.data ?? [],
        total: result?.total?.[0]?.count ?? 0,
        skip,
        limit,
      });
    }

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
    if (transferToId) {
      const transferAccount = await Account.findOne({ _id: transferToId, user: user.id, isArchived: false });
      if (!transferAccount) return NextResponse.json({ error: "Transfer account not found" }, { status: 404 });
    }

    const startDate = new Date(rest.date);
    // ── Bulk-create recurring installments ──────────────────────────────────
    // Explicit count/end-date series materialize exactly what the user asked for.
    // Open-ended series (no count, no end date — e.g. a recurring salary) only get
    // a small rolling window; topUpRecurringSeries() extends it as installments are consumed.
    const isOpenEnded = Boolean(
      rest.isRecurring && rest.recurrenceFrequency && !rest.recurrenceCount && !rest.recurrenceEndDate
    );
    const installmentCount = rest.isRecurring && rest.recurrenceFrequency
      ? (rest.recurrenceCount ?? (isOpenEnded ? OPEN_ENDED_WINDOW : 1))
      : 0;
    if (rest.isRecurring && installmentCount > 1 && rest.recurrenceFrequency) {
      const recurringId = new Types.ObjectId();
      const interval = rest.recurrenceInterval ?? 1;
      const dates = computeInstallmentDates(startDate, rest.recurrenceFrequency, interval, installmentCount);

      // No balance update at creation — installments only affect balance when marked paid
      const docs = dates.map((d, i) => ({
        ...rest,
        recurrenceCount: isOpenEnded ? undefined : installmentCount,
        recurrenceIsOpenEnded: isOpenEnded,
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
      for (const transaction of inserted) {
        await appendLedgerBlock({
          userId: user.id,
          scope: "transaction",
          entityId: transaction._id.toString(),
          action: "create",
          after: transaction,
          actor: user,
        });
      }
      await invalidateStatsCacheMany(user.id, dates);

      logger.info({ userId: user.id, recurringId: recurringId.toString(), count: docs.length }, "Recurring series created");
      return NextResponse.json(
        { data: inserted[0], seriesId: recurringId.toString(), count: docs.length },
        { status: 201 }
      );
    }

    // ── Single transaction (non-recurring or recurring count = 1) ───────────
    const accountBefore = account.toObject();
    const balanceDelta = rest.type === "income" ? rest.amount : -rest.amount;
    account.balance += balanceDelta;
    await account.save();
    await appendLedgerBlock({
      userId: user.id,
      scope: "account",
      entityId: account._id.toString(),
      action: "update",
      before: accountBefore,
      after: account,
      actor: user,
    });

    if (rest.type === "transfer" && transferToId) {
      const transferAccountBefore = await Account.findOne({ _id: transferToId, user: user.id });
      const transferAccount = await Account.findOneAndUpdate(
        { _id: transferToId, user: user.id },
        { $inc: { balance: rest.amount } },
        { new: true }
      );
      if (transferAccountBefore && transferAccount) {
        await appendLedgerBlock({
          userId: user.id,
          scope: "account",
          entityId: transferAccount._id.toString(),
          action: "update",
          before: transferAccountBefore,
          after: transferAccount,
          actor: user,
        });
      }
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
    await appendLedgerBlock({
      userId: user.id,
      scope: "transaction",
      entityId: transaction._id.toString(),
      action: "create",
      after: transaction,
      actor: user,
    });
    await invalidateStatsCache(user.id, startDate);

    if (rest.type === "expense") {
      void checkBudgetAlert(user.id, rest.category, rest.amount, startDate);
    }

    logger.info({ userId: user.id, transactionId: transaction._id.toString() }, "Transaction created");
    getIO()?.to(`user:${user.id}`).emit("data:changed", { resource: "transactions" });
    return NextResponse.json({ data: transaction }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/transactions failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
