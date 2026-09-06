import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import CreditStatement from "@/models/CreditStatement";
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

export type TransactionServiceErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "TRANSFER_ACCOUNT_NOT_FOUND"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_LOCKED"
  | "INSTALLMENT_NOT_FOUND";

export class TransactionServiceError extends Error {
  code: TransactionServiceErrorCode;

  constructor(code: TransactionServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TransactionServiceError";
  }
}

export const transactionUpdateSchema = z.object({
  description: z.string().optional(),
  note: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  date: z.string().optional(),
});

export type UpdateTransactionInput = z.infer<typeof transactionUpdateSchema> & {
  userId: string;
  transactionId: string;
  actor: AuthUser;
};

function hasRepaymentTag(tags?: unknown[]) {
  return (tags ?? []).some((tag) => typeof tag === "string" && tag.startsWith("repayment:"));
}

async function getLinkedTransactionBlocker(userId: string, transactionId: string, tags?: unknown[]) {
  const linkedStatement = await CreditStatement.findOne({
    user: userId,
    paymentTransactionId: transactionId,
    isDeleted: { $ne: true },
  }).select("_id").lean();
  if (linkedStatement) return "This transaction is linked to a credit statement payment.";
  if (hasRepaymentTag(tags)) return "This transaction is linked to a loan repayment.";
  return null;
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

async function invalidateStatsCacheSingle(userId: string, date: Date) {
  await invalidateStatsCache(userId, date);
}

// Shared with PATCH /api/transactions/[id] (browser) and the integration
// route — same field set, same linked-record guard.
export async function updateTransaction(input: UpdateTransactionInput) {
  const { userId, transactionId, actor, ...rest } = input;
  await connectDB();

  const existing = await Transaction.findOne({
    _id: transactionId,
    user: userId,
    isDeleted: { $ne: true },
  }).lean<{ date: Date; tags?: unknown[] }>();
  if (!existing) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }
  const blocker = await getLinkedTransactionBlocker(userId, transactionId, existing.tags);
  if (blocker) {
    throw new TransactionServiceError("TRANSACTION_LOCKED", `${blocker} Use the linked record flow to change it.`);
  }

  const update: Record<string, unknown> = { ...rest };
  if (rest.date) update.date = new Date(rest.date);

  const transaction = await Transaction.findOneAndUpdate(
    { _id: transactionId, user: userId, isDeleted: { $ne: true } },
    { $set: update },
    { new: true }
  ).lean();
  if (!transaction) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }

  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: transactionId,
    action: "update",
    before: existing,
    after: transaction,
    actor,
  });
  if (existing.date) await invalidateStatsCacheSingle(userId, new Date(existing.date));
  if (rest.date) await invalidateStatsCacheSingle(userId, new Date(rest.date));

  return transaction;
}

// Shared with DELETE /api/transactions/[id] (browser) and the integration
// route — same balance-reversal logic (transfer-aware), same linked-record guard.
export async function deleteTransaction(userId: string, transactionId: string, actor: AuthUser) {
  await connectDB();

  const txn = await Transaction.findOne({ _id: transactionId, user: userId, isDeleted: { $ne: true } }).lean<{
    account: { toString(): string };
    transferTo?: { toString(): string };
    type: string;
    amount: number;
    date: Date;
    tags?: unknown[];
    recurringId?: unknown;
    installmentStatus?: string;
  }>();
  if (!txn) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }
  const blocker = await getLinkedTransactionBlocker(userId, transactionId, txn.tags);
  if (blocker) {
    throw new TransactionServiceError("TRANSACTION_LOCKED", `${blocker} Use the linked record flow to reverse it.`);
  }

  // Reverse account balance only for transactions that previously affected it.
  const affectsBalance = !txn.recurringId || txn.installmentStatus === "paid";
  if (affectsBalance) {
    if (txn.type === "transfer") {
      const accountBefore = await Account.findOne({ _id: txn.account, user: userId });
      const accountAfter = await Account.findOneAndUpdate(
        { _id: txn.account, user: userId },
        { $inc: { balance: txn.amount } },
        { new: true }
      );
      if (accountBefore && accountAfter) {
        await appendLedgerBlock({
          userId,
          scope: "account",
          entityId: accountAfter._id.toString(),
          action: "update",
          before: accountBefore,
          after: accountAfter,
          actor,
        });
      }
      if (txn.transferTo) {
        const transferBefore = await Account.findOne({ _id: txn.transferTo, user: userId });
        const transferAfter = await Account.findOneAndUpdate(
          { _id: txn.transferTo, user: userId },
          { $inc: { balance: -txn.amount } },
          { new: true }
        );
        if (transferBefore && transferAfter) {
          await appendLedgerBlock({
            userId,
            scope: "account",
            entityId: transferAfter._id.toString(),
            action: "update",
            before: transferBefore,
            after: transferAfter,
            actor,
          });
        }
      }
    } else {
      const balanceDelta = txn.type === "income" ? -txn.amount : txn.amount;
      const accountBefore = await Account.findOne({ _id: txn.account, user: userId });
      const accountAfter = await Account.findOneAndUpdate(
        { _id: txn.account, user: userId },
        { $inc: { balance: balanceDelta } },
        { new: true }
      );
      if (accountBefore && accountAfter) {
        await appendLedgerBlock({
          userId,
          scope: "account",
          entityId: accountAfter._id.toString(),
          action: "update",
          before: accountBefore,
          after: accountAfter,
          actor,
        });
      }
    }
  }

  const deleted = await Transaction.findOneAndUpdate(
    { _id: transactionId, user: userId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } },
    { new: true }
  ).lean();
  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: transactionId,
    action: "delete",
    before: txn,
    after: deleted,
    actor,
  });
  await invalidateStatsCacheSingle(userId, new Date(txn.date));

  return deleted;
}

const installmentStatusSchema = z.enum(["paid", "skipped", "upcoming", "overdue"]);
export type InstallmentStatus = z.infer<typeof installmentStatusSchema>;

// Shared with PATCH /api/transactions/recurring/[recurringId]/installments/[id]
// (browser) and the integration route.
export async function setInstallmentStatus(
  userId: string,
  recurringId: string,
  installmentId: string,
  status: InstallmentStatus,
  actor: AuthUser
) {
  await connectDB();

  const installment = await Transaction.findOne({
    _id: installmentId,
    user: userId,
    isDeleted: { $ne: true },
    recurringId: new Types.ObjectId(recurringId),
  });
  if (!installment) {
    throw new TransactionServiceError("INSTALLMENT_NOT_FOUND", "Installment not found");
  }

  const installmentBefore = installment.toObject();
  const prevStatus = installment.installmentStatus;
  const previousPaidAt = installment.paidAt ? new Date(installment.paidAt) : undefined;
  const now = new Date();
  const installmentDate = new Date(installment.date);

  // Apply balance delta when marking paid — all installments, regardless of date
  if (status === "paid" && prevStatus !== "paid") {
    const delta = installment.type === "income" ? installment.amount : -installment.amount;
    const accountBefore = await Account.findOne({ _id: installment.account, user: userId });
    const accountAfter = await Account.findOneAndUpdate(
      { _id: installment.account, user: userId },
      { $inc: { balance: delta } },
      { new: true }
    );
    if (accountBefore && accountAfter) {
      await appendLedgerBlock({
        userId,
        scope: "account",
        entityId: accountAfter._id.toString(),
        action: "update",
        before: accountBefore,
        after: accountAfter,
        actor,
      });
    }
  }

  // Reverse balance if un-paying
  if (prevStatus === "paid" && status !== "paid") {
    const delta = installment.type === "income" ? -installment.amount : installment.amount;
    const accountBefore = await Account.findOne({ _id: installment.account, user: userId });
    const accountAfter = await Account.findOneAndUpdate(
      { _id: installment.account, user: userId },
      { $inc: { balance: delta } },
      { new: true }
    );
    if (accountBefore && accountAfter) {
      await appendLedgerBlock({
        userId,
        scope: "account",
        entityId: accountAfter._id.toString(),
        action: "update",
        before: accountBefore,
        after: accountAfter,
        actor,
      });
    }
  }

  installment.installmentStatus = status;
  installment.paidAt = status === "paid" ? now : undefined;
  await installment.save();
  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: installment._id.toString(),
    action: "update",
    before: installmentBefore,
    after: installment,
    actor,
  });

  if (status === "paid" && prevStatus !== "paid" && installment.type === "expense") {
    void checkBudgetAlert(userId, installment.category, installment.amount, now);
  }

  try {
    const cacheDates = [installmentDate, now, previousPaidAt].filter((item): item is Date => Boolean(item));
    await Promise.all(
      cacheDates.map((date) => invalidateStatsCacheSingle(userId, date))
    );
  } catch {
    // ignore
  }

  return installment;
}
