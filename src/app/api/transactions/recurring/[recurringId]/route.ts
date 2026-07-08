import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { Types } from "mongoose";
import { redis } from "@/lib/redis";
import { appendLedgerBlock } from "@/lib/ledger";

type Params = Promise<{ recurringId: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { recurringId } = await params;
    await connectDB();

    const installments = await Transaction.find({
      user: user.id,
      isDeleted: { $ne: true },
      recurringId: new Types.ObjectId(recurringId),
    })
      .sort({ installmentIndex: 1 })
      .lean();

    if (!installments.length) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    const now = new Date();
    const enriched = installments.map(t => ({
      ...t,
      installmentStatus:
        t.installmentStatus === "upcoming" && new Date(t.date) < now
          ? "overdue"
          : t.installmentStatus,
    }));

    const first = enriched[0];
    const total = enriched.reduce((s, t) => s + t.amount, 0);
    const paidCount = enriched.filter(t => t.installmentStatus === "paid").length;
    const remainingAmount = enriched
      .filter(t => t.installmentStatus !== "paid" && t.installmentStatus !== "skipped")
      .reduce((s, t) => s + t.amount, 0);

    return NextResponse.json({
      data: enriched,
      series: {
        recurringId,
        label: first.recurrenceLabel,
        description: first.description,
        category: first.category,
        amount: first.amount,
        frequency: first.recurrenceFrequency,
        interval: first.recurrenceInterval,
        count: installments.length,
        paidCount,
        remainingAmount,
        total,
        accountId: String(first.account),
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/recurring/[recurringId] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { recurringId } = await params;
    await connectDB();

    const toDelete = await Transaction.find({
      user: user.id,
      isDeleted: { $ne: true },
      recurringId: new Types.ObjectId(recurringId),
      installmentStatus: { $in: ["upcoming", "overdue"] },
    }).lean();

    if (!toDelete.length) {
      return NextResponse.json({ data: { deletedCount: 0 } });
    }

    const accountObjectId = toDelete[0].account;

    await Transaction.updateMany(
      { _id: { $in: toDelete.map(t => t._id) } },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } }
    );
    // Stop the background top-up job from regenerating this series if it was open-ended.
    await Transaction.updateMany(
      { user: user.id, recurringId: new Types.ObjectId(recurringId) },
      { $set: { recurrenceCancelled: true } }
    );
    for (const transaction of toDelete) {
      await appendLedgerBlock({
        userId: user.id,
        scope: "transaction",
        entityId: String(transaction._id),
        action: "delete",
        before: transaction,
        after: { ...transaction, isDeleted: true },
        actor: user,
      });
    }

    // Recompute the account balance from remaining transactions.
    // This corrects any stale balance left behind by old pre-Pay-to-Record data.
    const [balanceAgg] = await Transaction.aggregate([
      {
        $match: {
          account: accountObjectId,
          user: new Types.ObjectId(user.id),
          isDeleted: { $ne: true },
          // Only count paid recurring installments + all regular transactions
          $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
        },
      },
      {
        $group: {
          _id: null,
          balance: {
            $sum: {
              $cond: [{ $eq: ["$type", "income"] }, "$amount", { $multiply: [-1, "$amount"] }],
            },
          },
        },
      },
    ]);
    const accountBefore = await Account.findOne({ _id: accountObjectId, user: user.id });
    const accountAfter = await Account.findOneAndUpdate(
      { _id: accountObjectId, user: user.id },
      { balance: balanceAgg?.balance ?? 0 },
      { new: true }
    );
    if (accountBefore && accountAfter) {
      await appendLedgerBlock({
        userId: user.id,
        scope: "account",
        entityId: accountAfter._id.toString(),
        action: "update",
        before: accountBefore,
        after: accountAfter,
        actor: user,
      });
    }

    // Invalidate cache for all affected months
    if (redis) {
      const keys = new Set<string>();
      for (const t of toDelete) {
        const d = new Date(t.date);
        keys.add(`stats:v2:${user.id}:${d.getFullYear()}:${d.getMonth() + 1}`);
      }
      await Promise.all([...keys].map(k => redis!.del(k))).catch(() => null);
    }

    logger.info({ userId: user.id, recurringId, deletedCount: toDelete.length }, "Recurring series cancelled");
    return NextResponse.json({ data: { deletedCount: toDelete.length } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/transactions/recurring/[recurringId] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
