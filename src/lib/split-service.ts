import mongoose, { type ClientSession, Types } from "mongoose";
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
  originalCurrency?: string | null;
  deductible?: boolean | null;
  // False: history that never moved the balance; new lines cloned from it are history too.
  balanceApplied?: boolean;
  attachments?: string[];
};

export type SplitView = {
  splitGroupId: string | null;
  total: number;
  lines: { id: string; category: string; amount: number; description: string | null }[];
};

async function loadGroup(userId: string, transactionId: string, session?: ClientSession): Promise<Row[]> {
  if (!Types.ObjectId.isValid(transactionId)) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }
  await connectDB();
  const base = await Transaction.findOne({ _id: transactionId, user: userId, isDeleted: { $ne: true } }).session(session ?? null).lean<Row>();
  if (!base) throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  if (!base.splitGroupId) return [base];
  return Transaction.find({ user: userId, splitGroupId: base.splitGroupId, isDeleted: { $ne: true } })
    .sort({ _id: 1 })
    .session(session ?? null)
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

/** Another change got in the way (a write conflict that kept happening). Safe to send again. */
export class SplitBusyError extends Error {
  constructor(message = "This purchase was just changed somewhere else. Reload and try again.") {
    super(message);
    this.name = "SplitBusyError";
  }
}

/** The database cannot run transactions (a standalone MongoDB). */
export class SplitUnsupportedError extends Error {
  constructor() {
    super("This server needs a MongoDB replica set to edit split purchases.");
    this.name = "SplitUnsupportedError";
  }
}

type DriverError = { hasErrorLabel?: (label: string) => boolean; code?: number; message?: string };

function translateTransactionError(err: unknown): unknown {
  const e = err as DriverError;
  if (e?.hasErrorLabel?.("TransientTransactionError") || e?.hasErrorLabel?.("UnknownTransactionCommitResult") || e?.code === 112) {
    return new SplitBusyError();
  }
  if (e?.code === 20 || /Transaction numbers are only allowed on a replica set/i.test(e?.message ?? "")) {
    return new SplitUnsupportedError();
  }
  return err;
}

type LedgerEntry = { entityId: string; action: "create" | "update" | "delete"; before?: unknown; after?: unknown };

/**
 * Replace the lines of a split in ONE database transaction: rows, new rows and receipt moves all
 * commit together or not at all (production Mongo is a replica set, see docs/realtime.md). Every
 * edit rewrites the first line, so two edits at once collide there: Mongo aborts one with a write
 * conflict and `withTransaction` runs it again on the new state, so they apply one after the other
 * and the lines always add up. Ledger blocks are written after the commit, from what was changed.
 */
export async function replaceSplits(input: {
  userId: string;
  transactionId: string;
  splits: SplitLine[];
  actor: AuthUser;
}): Promise<SplitView> {
  const { userId, transactionId, splits, actor } = input;
  await connectDB();

  const sum = splits.reduce((n, l) => n + l.amount, 0);
  const ledger: LedgerEntry[] = [];
  const changed: SplitLine[] = [];
  let baseDate = new Date();
  let baseId = "";

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // The callback can run more than once: start from nothing each time.
      ledger.length = 0;
      changed.length = 0;

      const rows = await loadGroup(userId, transactionId, session);
      const base = rows[0];
      baseDate = new Date(base.date);
      baseId = base._id.toString();
      const total = rows.reduce((n, r) => n + r.amount, 0);
      if (sum !== total) {
        throw new TransactionServiceError("INVALID_SPLIT", "Split amounts must add up to the total");
      }
      for (const r of rows) {
        if (r.type !== "expense") throw new TransactionServiceError("INVALID_SPLIT", "Only expenses can be split");
        if (r.originalCurrency) {
          throw new TransactionServiceError("INVALID_SPLIT", "Split transactions must be in the base currency");
        }
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
        const blocker = await getLinkedTransactionBlocker(userId, r._id.toString(), r.tags, session);
        if (blocker) throw new TransactionServiceError("TRANSACTION_LOCKED", `${blocker} Use the linked record flow to change it.`);
      }
      const refunded = await Transaction.exists({
        user: userId,
        refundOf: { $in: rows.map((r) => r._id) },
        refundStatus: "confirmed",
        isDeleted: { $ne: true },
      }).session(session);
      if (refunded) {
        throw new TransactionServiceError("TRANSACTION_LOCKED", "This expense has a refund matched to it. Unlink the refund first.");
      }

      const groupId = base.splitGroupId ?? new Types.ObjectId();
      const kept = Math.min(rows.length, splits.length);
      const removed = rows.slice(splits.length);

      // Reuse existing rows in order, so ids stay stable for the lines that remain.
      for (let i = 0; i < kept; i++) {
        const row = rows[i];
        const line = splits[i];
        // A line keeps its own description unless the new line gives one.
        const description = line.description !== undefined ? line.description : row.description;
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
          { new: true, session }
        ).lean<Row>();
        if (!after) throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
        ledger.push({ entityId: row._id.toString(), action: "update", before: row, after });
        if (row.category !== line.category || row.amount !== line.amount) changed.push(line);
      }

      // More lines than rows: clone the shared fields into new rows.
      if (splits.length > rows.length) {
        const docs = splits.slice(rows.length).map((line) => ({
          user: userId,
          account: base.account,
          type: "expense" as const,
          currency: base.currency,
          subcategory: base.subcategory,
          note: base.note,
          // The tax helper's per-row choice carries over to the new lines.
          ...(typeof base.deductible === "boolean" ? { deductible: base.deductible } : {}),
          ...(base.balanceApplied === false ? { balanceApplied: false } : {}),
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
        const inserted = await Transaction.insertMany(docs, { session });
        for (const t of inserted) ledger.push({ entityId: t._id.toString(), action: "create", after: t });
        changed.push(...splits.slice(rows.length));
      }

      // Fewer lines than rows: move the extras' receipts to the first line, then remove the extras.
      for (const row of removed) {
        const receipts = await Receipt.find({ user: userId, transaction: row._id }).select("_id").session(session).lean<{ _id: Types.ObjectId }[]>();
        if (receipts.length) {
          // The cap sits in the same update, as when a receipt is added.
          const linked = await Transaction.updateOne(
            {
              _id: base._id,
              user: userId,
              $expr: { $lte: [{ $add: [{ $size: { $ifNull: ["$attachments", []] } }, receipts.length] }, MAX_RECEIPTS_PER_TRANSACTION] },
            },
            { $addToSet: { attachments: { $each: receipts.map((r) => r._id.toString()) } } },
            { session }
          );
          if (linked.matchedCount !== 1) {
            throw new TransactionServiceError("TOO_MANY_RECEIPTS", `More than ${MAX_RECEIPTS_PER_TRANSACTION} receipts would end up on one line. Remove some receipts first.`);
          }
          const moved = await Receipt.updateMany(
            { _id: { $in: receipts.map((r) => r._id) }, user: userId },
            { $set: { transaction: base._id } },
            { session }
          );
          // A receipt removed since it was read: abort rather than leave it listed on the first line.
          if (moved.matchedCount !== receipts.length) throw new SplitBusyError();
        }
        const deleted = await Transaction.findOneAndUpdate(
          { _id: row._id, user: userId, isDeleted: { $ne: true } },
          { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId, attachments: [] } },
          { new: true, session }
        ).lean();
        ledger.push({ entityId: row._id.toString(), action: "delete", before: row, after: deleted });
      }
    });
  } catch (err) {
    throw translateTransactionError(err);
  } finally {
    await session.endSession();
  }

  // Committed. The ledger is append-only and has its own retry, so it is written from what changed.
  for (const e of ledger) {
    try {
      await appendLedgerBlock({ userId, scope: "transaction", ...e, actor } as Parameters<typeof appendLedgerBlock>[0]);
    } catch (err) {
      logger.error({ err, userId, entityId: e.entityId }, "split edit committed but its ledger block could not be written");
    }
  }
  await invalidateStatsCacheMany(userId, [baseDate]);
  for (const line of changed) void checkBudgetAlert(userId, line.category, line.amount, baseDate);

  return view(await loadGroup(userId, baseId));
}
