import { deleteReceiptsOfTransactions } from "@/lib/receipt-service";
import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import type { AuthUser } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { redis } from "@/lib/redis";
import { appendLedgerBlock } from "@/lib/ledger";

// Read and cancel recurring series. Shared by the browser routes under
// /api/transactions/recurring and the integration routes, so both report and
// cancel identically. Series are rows on `transactions` grouped by recurringId;
// creating one goes through createTransaction (transaction-service.ts).

// ?upcoming=N: next N unpaid installments due within the next 7 days.
export async function listUpcomingInstallments(userId: string, limitParam: string, accountId?: string | null) {
  await connectDB();
  const limit = Math.min(parseInt(limitParam, 10) || 5, 20);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfWindow = new Date(startOfToday);
  endOfWindow.setDate(endOfWindow.getDate() + 7);
  endOfWindow.setHours(23, 59, 59, 999);
  const matchQ: Record<string, unknown> = {
    user: new Types.ObjectId(userId),
    isDeleted: { $ne: true },
    isRecurring: true,
    installmentStatus: "upcoming",
    date: { $gte: startOfToday, $lte: endOfWindow },
  };
  if (accountId) matchQ.account = new Types.ObjectId(accountId);
  return Transaction.find(matchQ).sort({ date: 1 }).limit(limit).lean();
}

// One row per series, with paid and remaining counts and the next due date.
export async function listRecurringSeries(userId: string, accountId?: string | null) {
  await connectDB();
  const matchQ: Record<string, unknown> = {
    user: new Types.ObjectId(userId),
    isDeleted: { $ne: true },
    isRecurring: true,
    recurringId: { $exists: true },
  };
  if (accountId) matchQ.account = new Types.ObjectId(accountId);

  return Transaction.aggregate([
    { $match: matchQ },
    { $sort: { installmentIndex: 1 } },
    {
      $group: {
        _id: "$recurringId",
        label: { $first: "$recurrenceLabel" },
        amount: { $first: "$amount" },
        type: { $first: "$type" },
        frequency: { $first: "$recurrenceFrequency" },
        interval: { $first: "$recurrenceInterval" },
        category: { $first: "$category" },
        accountId: { $first: { $toString: "$account" } },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
        paidCount: { $sum: { $cond: [{ $eq: ["$installmentStatus", "paid"] }, 1, 0] } },
        remainingCount: {
          $sum: { $cond: [{ $in: ["$installmentStatus", ["upcoming", "overdue"]] }, 1, 0] },
        },
        nextDue: {
          $min: { $cond: [{ $in: ["$installmentStatus", ["upcoming", "overdue"]] }, "$date", null] },
        },
        startDate: { $min: "$date" },
        description: { $first: "$description" },
      },
    },
    { $sort: { nextDue: 1 } },
  ]);
}

// Every installment of a series plus a summary, or null if the series is unknown.
export async function getRecurringSeries(userId: string, recurringId: string) {
  await connectDB();
  const installments = await Transaction.find({
    user: userId,
    isDeleted: { $ne: true },
    recurringId: new Types.ObjectId(recurringId),
  })
    .sort({ installmentIndex: 1 })
    .lean();
  if (!installments.length) return null;

  const now = new Date();
  const enriched = installments.map((t) => ({
    ...t,
    installmentStatus:
      t.installmentStatus === "upcoming" && new Date(t.date) < now ? "overdue" : t.installmentStatus,
  }));

  const first = enriched[0];
  const total = enriched.reduce((s, t) => s + t.amount, 0);
  const paidCount = enriched.filter((t) => t.installmentStatus === "paid").length;
  const remainingAmount = enriched
    .filter((t) => t.installmentStatus !== "paid" && t.installmentStatus !== "skipped")
    .reduce((s, t) => s + t.amount, 0);

  return {
    installments: enriched,
    series: {
      recurringId,
      label: first.recurrenceLabel,
      description: first.description,
      category: first.category,
      type: first.type,
      amount: first.amount,
      frequency: first.recurrenceFrequency,
      interval: first.recurrenceInterval,
      count: installments.length,
      paidCount,
      remainingAmount,
      total,
      accountId: String(first.account),
    },
  };
}

// Cancels the unpaid installments (soft delete), stops the top-up job from
// regenerating an open-ended series and recomputes the account balance.
export async function cancelRecurringSeries(userId: string, recurringId: string, actor: AuthUser) {
  await connectDB();

  const toDelete = await Transaction.find({
    user: userId,
    isDeleted: { $ne: true },
    recurringId: new Types.ObjectId(recurringId),
    installmentStatus: { $in: ["upcoming", "overdue"] },
  }).lean();

  if (!toDelete.length) return { deletedCount: 0 };

  const accountObjectId = toDelete[0].account;

  await Transaction.updateMany(
    { _id: { $in: toDelete.map((t) => t._id) } },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } }
  );
  // Private images go once the rows are deleted (a failure is logged and swept later).
  await deleteReceiptsOfTransactions(userId, toDelete.map((t) => t._id));
  // Stop the background top-up job from regenerating this series if it was open-ended.
  await Transaction.updateMany(
    { user: userId, recurringId: new Types.ObjectId(recurringId) },
    { $set: { recurrenceCancelled: true } }
  );
  for (const transaction of toDelete) {
    await appendLedgerBlock({
      userId,
      scope: "transaction",
      entityId: String(transaction._id),
      action: "delete",
      before: transaction,
      after: { ...transaction, isDeleted: true },
      actor,
    });
  }

  // Recompute the account balance from remaining transactions. This corrects any
  // stale balance left behind by old pre-Pay-to-Record data.
  const [balanceAgg] = await Transaction.aggregate([
    {
      $match: {
        account: accountObjectId,
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        // History rows never moved the balance (balanceApplied: false), so they are not counted either.
        balanceApplied: { $ne: false },
        // Only count paid recurring installments + all regular transactions
        $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
      },
    },
    {
      $group: {
        _id: null,
        balance: { $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amount", { $multiply: [-1, "$amount"] }] } },
      },
    },
  ]);
  const accountBefore = await Account.findOne({ _id: accountObjectId, user: userId });
  const accountAfter = await Account.findOneAndUpdate(
    { _id: accountObjectId, user: userId },
    { balance: balanceAgg?.balance ?? 0 },
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

  // Invalidate cache for all affected months
  if (redis) {
    const keys = new Set<string>();
    for (const t of toDelete) {
      const d = new Date(t.date);
      keys.add(`stats:v2:${userId}:${d.getFullYear()}:${d.getMonth() + 1}`);
    }
    await Promise.all([...keys].map((k) => redis!.del(k))).catch(() => null);
  }

  logger.info({ userId, recurringId, deletedCount: toDelete.length }, "Recurring series cancelled");
  return { deletedCount: toDelete.length };
}
