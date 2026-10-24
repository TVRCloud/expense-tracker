import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import { MAX_MINOR_AMOUNT } from "@/lib/currency";
import {
  createTransaction,
  deleteTransaction,
  getLinkedTransactionBlocker,
  invalidateStatsCacheMany,
} from "@/lib/transaction-service";

// Moving money between two of the user's own accounts. A transfer is one
// Transaction row (type "transfer", `account` is the source, `transferTo` the
// destination) that moves the balance and counts as neither income nor
// spending: stats, budgets and spend limits only read income and expense rows.
// create and delete reuse the shared transaction service (same balance and
// ledger rules); edit lives here because the generic update only touches notes.

export const TRANSFER_CATEGORY = "Transfer";

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), "Invalid account");

export const transferCreateSchema = z
  .object({
    fromAccountId: objectId,
    toAccountId: objectId,
    amount: z.number().int().positive().max(MAX_MINOR_AMOUNT),
    // Only the base currency's code is accepted (checked in createTransaction).
    currency: z.string().optional(),
    date: z.string().optional(),
    note: z.string().max(500).optional(),
    description: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.fromAccountId === data.toAccountId) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Transfer destination must be different" });
    }
    if (data.date && Number.isNaN(new Date(data.date).getTime())) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Invalid date" });
    }
  });

export const transferUpdateSchema = z
  .object({
    fromAccountId: objectId.optional(),
    toAccountId: objectId.optional(),
    amount: z.number().int().positive().max(MAX_MINOR_AMOUNT).optional(),
    date: z.string().optional(),
    note: z.string().max(500).optional(),
    description: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({ code: "custom", path: [], message: "Nothing to update" });
    }
    if (data.fromAccountId && data.fromAccountId === data.toAccountId) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Transfer destination must be different" });
    }
    if (data.date && Number.isNaN(new Date(data.date).getTime())) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Invalid date" });
    }
  });

export type TransferServiceErrorCode =
  | "TRANSFER_NOT_FOUND"
  | "TRANSFER_ACCOUNT_NOT_FOUND"
  | "TRANSFER_SAME_ACCOUNT"
  | "TRANSFER_LOCKED"
  | "TRANSFER_CURRENCY_MISMATCH";

export class TransferServiceError extends Error {
  code: TransferServiceErrorCode;

  constructor(code: TransferServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TransferServiceError";
  }
}

type TransferRow = {
  _id: { toString(): string };
  type: string;
  amount: number;
  currency: string;
  account: { toString(): string };
  transferTo?: { toString(): string } | null;
  date: Date;
  note?: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

/** The shape the integration routes return for a transfer. */
export function toTransferResponse(txn: TransferRow) {
  return {
    id: txn._id.toString(),
    type: "transfer" as const,
    amount: txn.amount,
    currency: txn.currency,
    fromAccountId: txn.account.toString(),
    toAccountId: txn.transferTo ? txn.transferTo.toString() : null,
    date: txn.date,
    note: txn.note ?? null,
    description: txn.description ?? null,
    createdAt: txn.createdAt,
    updatedAt: txn.updatedAt,
  };
}

export type CreateTransferInput = z.infer<typeof transferCreateSchema> & { userId: string; actor: AuthUser };

export async function createTransfer(input: CreateTransferInput) {
  const { userId, actor, fromAccountId, toAccountId, date, ...rest } = input;
  try {
    const result = await createTransaction({
      userId,
      actor,
      accountId: fromAccountId,
      transferToId: toAccountId,
      type: "transfer",
      category: TRANSFER_CATEGORY,
      amount: rest.amount,
      currency: rest.currency,
      note: rest.note,
      description: rest.description,
      date: date ?? new Date().toISOString(),
      tags: [],
      isRecurring: false,
      provenance: { source: "manual" },
    });
    return toTransferResponse(result.transaction as TransferRow);
  } catch (err) {
    // The shared service names the two lookups differently; the app only needs "an account was not found".
    if (err instanceof Error && err.name === "TransactionServiceError") {
      const code = (err as { code?: string }).code;
      if (code === "CURRENCY_MISMATCH") throw new TransferServiceError("TRANSFER_CURRENCY_MISMATCH", err.message);
      if (code === "ACCOUNT_NOT_FOUND" || code === "TRANSFER_ACCOUNT_NOT_FOUND") {
        throw new TransferServiceError("TRANSFER_ACCOUNT_NOT_FOUND", err.message);
      }
    }
    throw err;
  }
}

export type UpdateTransferInput = z.infer<typeof transferUpdateSchema> & {
  userId: string;
  transferId: string;
  actor: AuthUser;
};

async function loadTransfer(userId: string, transferId: string) {
  const txn = await Transaction.findOne({
    _id: transferId,
    user: userId,
    type: "transfer",
    isDeleted: { $ne: true },
  }).lean<(TransferRow & { tags?: unknown[] }) | null>();
  if (!txn) throw new TransferServiceError("TRANSFER_NOT_FOUND", "Transfer not found");
  return txn;
}

export async function getTransfer(userId: string, transferId: string) {
  await connectDB();
  return toTransferResponse(await loadTransfer(userId, transferId));
}

// Changes amount, accounts, date or notes of a transfer. Balances are fixed in
// one pass: the old movement is reversed and the new one applied, per account,
// so an edit that keeps an account never leaves it half-moved.
export async function updateTransfer(input: UpdateTransferInput) {
  const { userId, transferId, actor, ...changes } = input;
  await connectDB();

  const existing = await loadTransfer(userId, transferId);
  const blocker = await getLinkedTransactionBlocker(userId, transferId, existing.tags);
  if (blocker) throw new TransferServiceError("TRANSFER_LOCKED", `${blocker} Use the linked record flow to change it.`);

  const oldFrom = existing.account.toString();
  const oldTo = existing.transferTo?.toString() ?? null;
  const newFrom = changes.fromAccountId ?? oldFrom;
  const newTo = changes.toAccountId ?? oldTo;
  const newAmount = changes.amount ?? existing.amount;
  if (!newTo) throw new TransferServiceError("TRANSFER_ACCOUNT_NOT_FOUND", "Transfer account not found");
  if (newFrom === newTo) throw new TransferServiceError("TRANSFER_SAME_ACCOUNT", "Transfer destination must be different");

  // A moved end must be one of the user's live accounts. An end that stays put
  // is not re-checked, so a transfer into an account archived since can still be edited.
  for (const id of [newFrom, newTo]) {
    if (id === oldFrom || id === oldTo) continue;
    const account = await Account.findOne({ _id: id, user: userId, isArchived: { $ne: true } }).select("_id").lean();
    if (!account) throw new TransferServiceError("TRANSFER_ACCOUNT_NOT_FOUND", "Transfer account not found");
  }

  const delta = new Map<string, number>();
  const add = (id: string | null, by: number) => {
    if (id) delta.set(id, (delta.get(id) ?? 0) + by);
  };
  add(oldFrom, existing.amount); // give back what the old transfer took
  add(oldTo, -existing.amount); // take back what it added
  add(newFrom, -newAmount);
  add(newTo, newAmount);

  for (const [accountId, by] of delta) {
    if (by === 0) continue;
    const before = await Account.findOne({ _id: accountId, user: userId });
    const after = await Account.findOneAndUpdate({ _id: accountId, user: userId }, { $inc: { balance: by } }, { new: true });
    if (before && after) {
      await appendLedgerBlock({ userId, scope: "account", entityId: accountId, action: "update", before, after, actor });
    }
  }

  const set: Record<string, unknown> = { account: newFrom, transferTo: newTo, amount: newAmount };
  if (changes.date) set.date = new Date(changes.date);
  if (changes.note !== undefined) set.note = changes.note;
  if (changes.description !== undefined) set.description = changes.description;

  const updated = await Transaction.findOneAndUpdate(
    { _id: transferId, user: userId, isDeleted: { $ne: true } },
    { $set: set },
    { new: true }
  ).lean<TransferRow | null>();
  if (!updated) throw new TransferServiceError("TRANSFER_NOT_FOUND", "Transfer not found");

  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: transferId,
    action: "update",
    before: existing,
    after: updated,
    actor,
  });
  await invalidateStatsCacheMany(userId, [new Date(existing.date), new Date(updated.date)]);

  return toTransferResponse(updated);
}

export async function deleteTransfer(userId: string, transferId: string, actor: AuthUser) {
  await connectDB();
  await loadTransfer(userId, transferId);
  try {
    await deleteTransaction(userId, transferId, actor);
  } catch (err) {
    if (err instanceof Error && err.name === "TransactionServiceError") {
      const code = (err as { code?: string }).code;
      if (code === "TRANSACTION_LOCKED") throw new TransferServiceError("TRANSFER_LOCKED", err.message);
      if (code === "TRANSACTION_NOT_FOUND") throw new TransferServiceError("TRANSFER_NOT_FOUND", err.message);
    }
    throw err;
  }
  return { id: transferId, deleted: true as const };
}
