import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Receipt from "@/models/Receipt";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import { checkBudgetAlert } from "@/lib/budget-alert";
import { isReservedTag } from "@/lib/tags";
import { MAX_RECEIPTS_PER_TRANSACTION } from "@/lib/receipt-service";
import logger from "@/lib/logger";
import {
  getLinkedTransactionBlocker,
  invalidateStatsCacheMany,
  MAX_SPLIT_LINES,
  splitLineSchema,
  TransactionServiceError,
} from "@/lib/transaction-service";

// Edit the lines of a split purchase, or turn a plain expense into one.
// A split is one real Transaction row per category sharing `splitGroupId`
// (created by createTransaction), so stats and budgets already count each line
// under its own category. The lines always add up to the same total, so no
// account balance moves here. Receipts follow the first line.

// How long an edit holds the first line before another may take over (the process died).
const BUSY_MS = 30_000;

export const splitUpdateSchema = z
  .object({ splits: z.array(splitLineSchema).min(2).max(MAX_SPLIT_LINES) })
  .superRefine((d, ctx) => {
    for (const [i, line] of d.splits.entries()) {
      if (line.amount > Number.MAX_SAFE_INTEGER / MAX_SPLIT_LINES) {
        ctx.addIssue({ code: "custom", path: ["splits", i, "amount"], message: "Amount is too large" });
      }
    }
  });
export type SplitLine = z.infer<typeof splitLineSchema>;

type Row = {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  account: Types.ObjectId;
  type: string;
  amount: number;
  currency?: string;
  category: string;
  subcategory?: string;
  description?: string;
  note?: string;
  date: Date;
  tags?: string[];
  source?: string;
  reviewStatus?: string | null;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  recurringId?: unknown;
  isRecurring?: boolean;
  splitGroupId?: Types.ObjectId;
  attachments?: string[];
  splitRev?: number;
};

export type SplitView = {
  splitGroupId: string | null;
  total: number;
  lines: { id: string; category: string; amount: number; description: string | null }[];
};

async function loadGroup(userId: string, transactionId: string): Promise<Row[]> {
  if (!Types.ObjectId.isValid(transactionId)) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }
  await connectDB();
  const base = await Transaction.findOne({ _id: transactionId, user: userId, isDeleted: { $ne: true } }).lean<Row>();
  if (!base) throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  if (!base.splitGroupId) return [base];
  return Transaction.find({ user: userId, splitGroupId: base.splitGroupId, isDeleted: { $ne: true } })
    .sort({ _id: 1 })
    .lean<Row[]>();
}

function view(rows: Row[]): SplitView {
  return {
    splitGroupId: rows[0].splitGroupId ? rows[0].splitGroupId.toString() : null,
    total: rows.reduce((sum, r) => sum + r.amount, 0),
    lines: rows.map((r) => ({
      id: r._id.toString(),
      category: r.category,
      amount: r.amount,
      description: r.description ?? null,
    })),
  };
}

/** The lines of a split (any line's id), or the one row of a plain transaction. */
export async function getSplit(userId: string, transactionId: string): Promise<SplitView> {
  return view(await loadGroup(userId, transactionId));
}

export async function replaceSplits(input: {
  userId: string;
  transactionId: string;
  splits: SplitLine[];
  actor: AuthUser;
}): Promise<SplitView> {
  const { userId, transactionId, splits, actor } = input;
  const rows = await loadGroup(userId, transactionId);
  const base = rows[0];
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  const sum = splits.reduce((n, l) => n + l.amount, 0);
  if (sum !== total) {
    throw new TransactionServiceError("INVALID_SPLIT", "Split amounts must add up to the total");
  }
  for (const r of rows) {
    if (r.type !== "expense") throw new TransactionServiceError("INVALID_SPLIT", "Only expenses can be split");
    if (r.isRecurring || r.recurringId) {
      throw new TransactionServiceError("INVALID_SPLIT", "Recurring payments can't be split");
    }
    if (r.reviewStatus === "voided") throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
    if (r.reviewStatus === "unreviewed") {
      throw new TransactionServiceError("TRANSACTION_LOCKED", "Confirm this transaction in Review before splitting it.");
    }
    if ((r.tags ?? []).some((t) => t.startsWith("loan:") || t === "loan_principal")) {
      throw new TransactionServiceError("TRANSACTION_LOCKED", "This transaction is linked to a loan. Use the loan to change it.");
    }
    const blocker = await getLinkedTransactionBlocker(userId, r._id.toString(), r.tags);
    if (blocker) throw new TransactionServiceError("TRANSACTION_LOCKED", `${blocker} Use the linked record flow to change it.`);
  }
  const refunded = await Transaction.exists({
    user: userId,
    refundOf: { $in: rows.map((r) => r._id) },
    refundStatus: "confirmed",
    isDeleted: { $ne: true },
  });
  if (refunded) {
    throw new TransactionServiceError("TRANSACTION_LOCKED", "This expense has a refund matched to it. Unlink the refund first.");
  }

  // Removed lines hand their receipts to the first line: refuse before anything changes if that is too many.
  const removed = rows.slice(splits.length);
  if (removed.length) {
    const total = await Receipt.countDocuments({ user: userId, transaction: { $in: [base._id, ...removed.map((r) => r._id)] } });
    if (total > MAX_RECEIPTS_PER_TRANSACTION) {
      throw new TransactionServiceError(
        "TOO_MANY_RECEIPTS",
        `Removing these lines would leave more than ${MAX_RECEIPTS_PER_TRANSACTION} receipts on one line. Remove some receipts first.`
      );
    }
  }

  // Claim the first line: a compare on `splitRev` (an edit that read the group before this one) and a
  // busy marker (an edit that reads it while this one is half-written). Of edits made at once only
  // one gets past here. The marker clears when this edit ends and goes stale after BUSY_MS if the
  // process dies.
  const now = new Date();
  const claimed = await Transaction.updateOne(
    {
      _id: base._id,
      user: userId,
      isDeleted: { $ne: true },
      splitRev: base.splitRev ?? null,
      $or: [{ splitBusyUntil: null }, { splitBusyUntil: { $lt: now } }],
    },
    { $inc: { splitRev: 1 }, $set: { splitBusyUntil: new Date(now.getTime() + BUSY_MS) } }
  );
  if (claimed.modifiedCount !== 1) {
    throw new TransactionServiceError("SPLIT_CONFLICT", "This purchase was just changed somewhere else. Reload and try again.");
  }

  const groupId = base.splitGroupId ?? new Types.ObjectId();
  const changed: SplitLine[] = [];
  const kept = Math.min(rows.length, splits.length);
  // What a rollback needs: the rows as they were, the clones made, the receipts moved.
  const touched: Row[] = [];
  const written = new Map<string, unknown>();
  const insertedIds: Types.ObjectId[] = [];
  const movedReceipts: { id: Types.ObjectId; from: Types.ObjectId }[] = [];

  try {
    // Reuse existing rows in order, so ids stay stable for the lines that remain.
    for (let i = 0; i < kept; i++) {
      const row = rows[i];
      const line = splits[i];
      // A line keeps its own description unless the new line gives one.
      const description = line.description !== undefined ? line.description : row.description;
      const sameLine = row.category === line.category && row.amount === line.amount;
      touched.push(row);
      const after = await Transaction.findOneAndUpdate(
        { _id: row._id, user: userId, isDeleted: { $ne: true } },
        {
          $set: {
            category: line.category,
            amount: line.amount,
            splitGroupId: groupId,
            ...(description !== undefined ? { description } : {}),
          },
        },
        { new: true }
      ).lean<Row>();
      if (!after) throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
      written.set(row._id.toString(), after);
      await appendLedgerBlock({ userId, scope: "transaction", entityId: row._id.toString(), action: "update", before: row, after, actor });
      if (!sameLine) changed.push(line);
    }

    // More lines than rows: clone the shared fields into new rows.
    if (splits.length > rows.length) {
      const docs = splits.slice(rows.length).map((line) => ({
        _id: new Types.ObjectId(),
        user: userId,
        account: base.account,
        type: "expense" as const,
        currency: base.currency,
        subcategory: base.subcategory,
        note: base.note,
        date: base.date,
        // Link tags (loan:, repayment:, credit_statement:) belong to one row; never copied.
        tags: (base.tags ?? []).filter((t) => !isReservedTag(t)),
        source: base.source,
        reviewStatus: base.reviewStatus ?? null,
        reviewedAt: base.reviewedAt,
        reviewedBy: base.reviewedBy,
        category: line.category,
        amount: line.amount,
        description: line.description ?? base.description,
        splitGroupId: groupId,
      }));
      insertedIds.push(...docs.map((d) => d._id));
      const inserted = await Transaction.insertMany(docs);
      for (const t of inserted) {
        await appendLedgerBlock({ userId, scope: "transaction", entityId: t._id.toString(), action: "create", after: t, actor });
      }
      changed.push(...splits.slice(rows.length));
    }

    // Fewer lines than rows: move the extras' receipts to the first line, then remove the extras.
    for (const row of removed) {
      const receipts = await Receipt.find({ user: userId, transaction: row._id }).select("_id").lean<{ _id: Types.ObjectId }[]>();
      if (receipts.length) {
        // The cap sits in the same atomic update, as when a receipt is added.
        const linked = await Transaction.updateOne(
          {
            _id: base._id,
            user: userId,
            $expr: { $lte: [{ $add: [{ $size: { $ifNull: ["$attachments", []] } }, receipts.length] }, MAX_RECEIPTS_PER_TRANSACTION] },
          },
          { $addToSet: { attachments: { $each: receipts.map((r) => r._id.toString()) } } }
        );
        if (linked.matchedCount !== 1) {
          throw new TransactionServiceError("TOO_MANY_RECEIPTS", `More than ${MAX_RECEIPTS_PER_TRANSACTION} receipts would end up on one line. Remove some receipts first.`);
        }
        movedReceipts.push(...receipts.map((r) => ({ id: r._id, from: row._id })));
        await Receipt.updateMany({ _id: { $in: receipts.map((r) => r._id) }, user: userId }, { $set: { transaction: base._id } });
      }
      touched.push(row);
      const deleted = await Transaction.findOneAndUpdate(
        { _id: row._id, user: userId, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId, attachments: [] } },
        { new: true }
      ).lean();
      written.set(row._id.toString(), deleted);
      await appendLedgerBlock({ userId, scope: "transaction", entityId: row._id.toString(), action: "delete", before: row, after: deleted, actor });
    }
  } catch (err) {
    await rollback({ userId, actor, touched, written, insertedIds, movedReceipts });
    throw err;
  } finally {
    await Transaction.updateOne({ _id: base._id, user: userId }, { $unset: { splitBusyUntil: 1 } }).catch((e) =>
      logger.error({ err: e, userId }, "could not clear the split busy marker")
    );
  }

  await invalidateStatsCacheMany(userId, [new Date(base.date)]);
  for (const line of changed) void checkBudgetAlert(userId, line.category, line.amount, new Date(base.date));

  return view(await loadGroup(userId, base._id.toString()));
}

// Puts a half-applied edit back: rows from their snapshots, clones removed, receipts returned.
// Each step is tried on its own so one failure does not stop the rest. The ledger gets matching
// blocks (it is append-only), so the chain shows the edit and its undo.
async function rollback(args: {
  userId: string;
  actor: AuthUser;
  touched: Row[];
  written: Map<string, unknown>;
  insertedIds: Types.ObjectId[];
  movedReceipts: { id: Types.ObjectId; from: Types.ObjectId }[];
}) {
  const { userId, actor, touched, written, insertedIds, movedReceipts } = args;
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, userId, what }, "split edit rollback step failed");
    }
  };
  for (const m of movedReceipts) {
    await attempt("receipt", () => Receipt.updateOne({ _id: m.id, user: userId }, { $set: { transaction: m.from } }));
  }
  if (insertedIds.length) {
    const clones = await Transaction.find({ _id: { $in: insertedIds }, user: userId }).lean().catch(() => []);
    await attempt("clones", () => Transaction.deleteMany({ _id: { $in: insertedIds }, user: userId }));
    for (const c of clones) {
      await attempt("clone ledger", () =>
        appendLedgerBlock({ userId, scope: "transaction", entityId: String(c._id), action: "delete", before: c, after: null, actor })
      );
    }
  }
  for (const row of touched) {
    const set: Record<string, unknown> = {
      category: row.category,
      amount: row.amount,
      attachments: row.attachments ?? [],
      isDeleted: false,
    };
    const unset: Record<string, 1> = { deletedAt: 1, deletedBy: 1 };
    if (row.description !== undefined) set.description = row.description;
    else unset.description = 1;
    if (row.splitGroupId) set.splitGroupId = row.splitGroupId;
    else unset.splitGroupId = 1;
    await attempt("row", () => Transaction.updateOne({ _id: row._id, user: userId }, { $set: set, $unset: unset }));
    const after = written.get(row._id.toString());
    if (after) {
      await attempt("row ledger", () =>
        appendLedgerBlock({ userId, scope: "transaction", entityId: row._id.toString(), action: "update", before: after, after: row, actor })
      );
    }
  }
}
