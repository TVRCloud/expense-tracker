import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import type { AuthUser } from "@/lib/auth-guard";
import { redis } from "@/lib/redis";
import { checkBudgetAlert } from "@/lib/budget-alert";
import { computeInstallmentDates, OPEN_ENDED_WINDOW } from "@/lib/recurrence";
import { appendLedgerBlock } from "@/lib/ledger";
import logger from "@/lib/logger";

// Shared transaction-creation business logic, used by both the browser-facing
// POST /api/transactions route and the n8n-facing POST /api/integrations/transactions
// route. Do not duplicate this logic in either caller — extend it here instead.
//
// This preserves the app's existing (weaker) consistency model exactly: no
// mongoose sessions/transactions are used anywhere in this codebase, so
// mutations below remain sequential and non-atomic, same as before extraction.

export const transactionCreateSchema = z
  .object({
    accountId: z.string(),
    type: z.enum(["income", "expense", "transfer"]),
    amount: z.number().int().positive(),
    currency: z.string().default("INR"),
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
  })
  .superRefine((data, ctx) => {
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
      ctx.addIssue({
        code: "custom",
        path: ["transferToId"],
        message: "Transfer destination is only allowed for transfers",
      });
    }
    if (data.type === "transfer" && data.transferToId === data.accountId) {
      ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Transfer destination must be different" });
    }
    if (data.type === "transfer" && data.isRecurring) {
      ctx.addIssue({ code: "custom", path: ["isRecurring"], message: "Recurring transfers are not supported" });
    }
  });

export type CreateTransactionInput = z.infer<typeof transactionCreateSchema> & {
  userId: string;
  actor: AuthUser;
};

export type CreateTransactionResult =
  | { kind: "single"; transaction: unknown }
  | { kind: "series"; transaction: unknown; seriesId: string; count: number };

export class TransactionServiceError extends Error {
  code: "ACCOUNT_NOT_FOUND" | "TRANSFER_ACCOUNT_NOT_FOUND";

  constructor(code: "ACCOUNT_NOT_FOUND" | "TRANSFER_ACCOUNT_NOT_FOUND", message: string) {
    super(message);
    this.code = code;
    this.name = "TransactionServiceError";
  }
}

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
    await Promise.all([...keys].map((k) => redis!.del(k)));
  } catch {
    // Redis unavailable
  }
}

export async function createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
  const { userId, actor, accountId, transferToId, ...rest } = input;
  await connectDB();

  const account = await Account.findOne({ _id: accountId, user: userId });
  if (!account) {
    throw new TransactionServiceError("ACCOUNT_NOT_FOUND", "Account not found");
  }
  if (transferToId) {
    const transferAccount = await Account.findOne({ _id: transferToId, user: userId, isArchived: false });
    if (!transferAccount) {
      throw new TransactionServiceError("TRANSFER_ACCOUNT_NOT_FOUND", "Transfer account not found");
    }
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
      user: userId,
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
        userId,
        scope: "transaction",
        entityId: transaction._id.toString(),
        action: "create",
        after: transaction,
        actor,
      });
    }
    await invalidateStatsCacheMany(userId, dates);

    logger.info({ userId, recurringId: recurringId.toString(), count: docs.length }, "Recurring series created");
    return { kind: "series", transaction: inserted[0], seriesId: recurringId.toString(), count: docs.length };
  }

  // ── Single transaction (non-recurring or recurring count = 1) ───────────
  const accountBefore = account.toObject();
  const balanceDelta = rest.type === "income" ? rest.amount : -rest.amount;
  account.balance += balanceDelta;
  await account.save();
  await appendLedgerBlock({
    userId,
    scope: "account",
    entityId: account._id.toString(),
    action: "update",
    before: accountBefore,
    after: account,
    actor,
  });

  if (rest.type === "transfer" && transferToId) {
    const transferAccountBefore = await Account.findOne({ _id: transferToId, user: userId });
    const transferAccount = await Account.findOneAndUpdate(
      { _id: transferToId, user: userId },
      { $inc: { balance: rest.amount } },
      { new: true }
    );
    if (transferAccountBefore && transferAccount) {
      await appendLedgerBlock({
        userId,
        scope: "account",
        entityId: transferAccount._id.toString(),
        action: "update",
        before: transferAccountBefore,
        after: transferAccount,
        actor,
      });
    }
  }

  const transaction = await Transaction.create({
    ...rest,
    account: accountId,
    user: userId,
    date: startDate,
    recurrenceInterval: rest.isRecurring ? (rest.recurrenceInterval ?? 1) : undefined,
    recurrenceEndDate: rest.recurrenceEndDate ? new Date(rest.recurrenceEndDate) : undefined,
    ...(transferToId ? { transferTo: transferToId } : {}),
  });
  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: transaction._id.toString(),
    action: "create",
    after: transaction,
    actor,
  });
  await invalidateStatsCache(userId, startDate);

  if (rest.type === "expense") {
    void checkBudgetAlert(userId, rest.category, rest.amount, startDate);
  }

  logger.info({ userId, transactionId: transaction._id.toString() }, "Transaction created");
  return { kind: "single", transaction };
}
