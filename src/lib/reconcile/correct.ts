import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import TransactionCorrection from "@/models/TransactionCorrection";
import CapturedMessage from "@/models/CapturedMessage";
import LedgerBlock from "@/models/LedgerBlock";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import {
  deleteTransaction,
  getLinkedTransactionBlocker,
  invalidateStatsCacheMany,
} from "@/lib/transaction-service";
import logger from "@/lib/logger";
import { learnDigitsFromCapture } from "@/lib/capture/account-match";

// Reconcile: confirm an auto-captured transaction, or fix it in place and
// keep a permanent TransactionCorrection record of what changed. Shared by
// the web routes (/api/transactions/:id/...), the phone's review routes
// (/api/integrations/review/...), and ingest when a late SMS replaces values
// that came from a lower-priority source.
//
// Balance changes use atomic $inc per account and every write goes through
// the ledger chain, same as createTransaction/deleteTransaction.

export const USER_CORRECTION_REASONS = [
  "wrong_amount",
  "wrong_type",
  "wrong_account",
  "wrong_date",
  "wrong_category",
  "wrong_merchant",
  "duplicate",
  "not_a_transaction",
  "other",
] as const;

export type CorrectionReason =
  | (typeof USER_CORRECTION_REASONS)[number]
  | "sms_override"
  | "kept_user_values";

export type CorrectionVia = "web" | "mobile" | "system";

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), "Invalid id");

export const correctionChangesSchema = z
  .object({
    amount: z.number().int().positive().optional(),
    type: z.enum(["income", "expense"]).optional(),
    accountId: objectId.optional(),
    date: z.string().datetime().optional(),
    category: z.string().trim().min(1).max(50).optional(),
    description: z.string().trim().max(200).optional(),
  })
  .strict();

export const correctionRequestSchema = z.object({
  changes: correctionChangesSchema.default({}),
  reason: z.enum(USER_CORRECTION_REASONS),
  note: z.string().trim().max(500).optional(),
});

export type CorrectionChanges = z.infer<typeof correctionChangesSchema>;

export type ReconcileErrorCode =
  | "NOT_FOUND"
  | "NOT_CORRECTABLE"
  | "ACCOUNT_NOT_FOUND"
  | "NO_CHANGES"
  | "INVALID_STATE";

export class ReconcileError extends Error {
  code: ReconcileErrorCode;
  constructor(code: ReconcileErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ReconcileError";
  }
}

type TxnDoc = {
  _id: Types.ObjectId;
  account: Types.ObjectId;
  type: "income" | "expense" | "transfer";
  amount: number;
  category: string;
  date: Date;
  description?: string;
  tags?: unknown[];
  splitGroupId?: unknown;
  recurringId?: unknown;
  isRecurring?: boolean;
  sourceCapture?: Types.ObjectId;
  reviewStatus?: string | null;
};

export type Snapshot = {
  amount: number;
  type: string;
  account: string;
  category: string;
  date: Date;
  description?: string;
};

function snapshotOf(t: Pick<TxnDoc, "amount" | "type" | "account" | "category" | "date" | "description">): Snapshot {
  return {
    amount: t.amount,
    type: t.type,
    account: t.account.toString(),
    category: t.category,
    date: new Date(t.date),
    description: t.description ?? "",
  };
}

/** Signed effect of a transaction on its own account's balance. */
function balanceEffect(type: string, amount: number) {
  return type === "income" ? amount : -amount;
}

async function loadCorrectable(userId: string, transactionId: string): Promise<TxnDoc> {
  if (!Types.ObjectId.isValid(transactionId)) throw new ReconcileError("NOT_FOUND", "Transaction not found");
  const txn = await Transaction.findOne({
    _id: transactionId,
    user: userId,
    isDeleted: { $ne: true },
  }).lean<TxnDoc>();
  if (!txn) throw new ReconcileError("NOT_FOUND", "Transaction not found");

  if (txn.type === "transfer" || txn.splitGroupId || txn.recurringId || txn.isRecurring) {
    throw new ReconcileError(
      "NOT_CORRECTABLE",
      "Transfers, split and recurring transactions can't be corrected here. Edit them from the transaction instead."
    );
  }
  const blocker = await getLinkedTransactionBlocker(userId, transactionId, txn.tags);
  if (blocker) throw new ReconcileError("NOT_CORRECTABLE", `${blocker} Use the linked record flow to change it.`);
  return txn;
}

async function incBalance(userId: string, accountId: string, delta: number, actor: AuthUser) {
  if (delta === 0) return;
  const before = await Account.findOne({ _id: accountId, user: userId }).lean();
  const after = await Account.findOneAndUpdate(
    { _id: accountId, user: userId },
    { $inc: { balance: delta } },
    { new: true }
  ).lean();
  if (before && after) {
    await appendLedgerBlock({ userId, scope: "account", entityId: accountId, action: "update", before, after, actor });
  }
}

export function changedFieldsOf(before: Snapshot, after: Snapshot): string[] {
  const fields: string[] = [];
  if (before.amount !== after.amount) fields.push("amount");
  if (before.type !== after.type) fields.push("type");
  if (before.account !== after.account) fields.push("account");
  if (before.category !== after.category) fields.push("category");
  if (before.date.getTime() !== after.date.getTime()) fields.push("date");
  if ((before.description ?? "") !== (after.description ?? "")) fields.push("description");
  return fields;
}

export type CorrectInput = {
  userId: string;
  transactionId: string;
  changes: CorrectionChanges;
  reason: CorrectionReason;
  note?: string;
  via: CorrectionVia;
  actor: AuthUser;
  capturedMessageId?: string;
  /** Set when a new capture's values replace the current ones (sms_override). */
  sourceUpdate?: { source: "sms" | "n8n" | "notification"; sourceCapture: string };
};

export async function correctTransaction(input: CorrectInput) {
  await connectDB();
  if (input.reason === "duplicate" || input.reason === "not_a_transaction") {
    return voidTransaction(input);
  }

  const txn = await loadCorrectable(input.userId, input.transactionId);
  const before = snapshotOf(txn);
  const after: Snapshot = {
    amount: input.changes.amount ?? before.amount,
    type: input.changes.type ?? before.type,
    account: input.changes.accountId ?? before.account,
    category: input.changes.category ?? before.category,
    date: input.changes.date ? new Date(input.changes.date) : before.date,
    description: input.changes.description ?? before.description,
  };
  const changedFields = changedFieldsOf(before, after);
  if (changedFields.length === 0 && input.reason !== "kept_user_values" && !input.sourceUpdate) {
    throw new ReconcileError("NO_CHANGES", "Nothing to change: the new values match the current ones");
  }

  if (after.account !== before.account) {
    const target = await Account.exists({ _id: after.account, user: input.userId, isArchived: { $ne: true } });
    if (!target) throw new ReconcileError("ACCOUNT_NOT_FOUND", "Account not found");
  }

  // Reverse the old effect and apply the new one.
  const oldEffect = balanceEffect(before.type, before.amount);
  const newEffect = balanceEffect(after.type, after.amount);
  const balanceEffects: { account: string; delta: number }[] = [];
  if (after.account === before.account) {
    const delta = newEffect - oldEffect;
    if (delta !== 0) balanceEffects.push({ account: before.account, delta });
  } else {
    balanceEffects.push({ account: before.account, delta: -oldEffect });
    balanceEffects.push({ account: after.account, delta: newEffect });
  }
  for (const effect of balanceEffects) {
    await incBalance(input.userId, effect.account, effect.delta, input.actor);
  }

  const isUser = input.via !== "system";
  const set: Record<string, unknown> = {
    amount: after.amount,
    type: after.type,
    account: after.account,
    category: after.category,
    date: after.date,
    description: after.description,
  };
  if (isUser) {
    set.reviewStatus = input.reason === "kept_user_values" ? txn.reviewStatus ?? "confirmed" : "corrected";
    set.reviewedAt = new Date();
    set.reviewedBy = input.userId;
  }
  if (input.sourceUpdate) {
    set.source = input.sourceUpdate.source;
    set.sourceCapture = input.sourceUpdate.sourceCapture;
  }
  const update: Record<string, unknown> = { $set: set };
  if (input.capturedMessageId) update.$addToSet = { captures: input.capturedMessageId };

  const updated = await Transaction.findOneAndUpdate(
    { _id: txn._id, user: input.userId, isDeleted: { $ne: true } },
    update,
    { new: true }
  ).lean();

  const block = await appendLedgerBlock({
    userId: input.userId,
    scope: "transaction",
    entityId: txn._id.toString(),
    action: "update",
    before: txn,
    after: updated,
    actor: input.actor,
  });

  const correction = await TransactionCorrection.create({
    user: input.userId,
    transaction: txn._id,
    capturedMessage: input.capturedMessageId,
    before,
    after,
    changedFields,
    reason: input.reason,
    note: input.note,
    via: input.via,
    correctedBy: isUser ? input.userId : undefined,
    balanceEffects,
    ledgerSequence: block.sequence,
  });

  // Keep the primary capture's eventKey in step with the values in use, so a
  // later message is matched against the corrected payment.
  const primary = input.sourceUpdate?.sourceCapture ?? txn.sourceCapture?.toString();
  if (primary) {
    await CapturedMessage.updateOne(
      { _id: primary, user: input.userId },
      { $set: { "eventKey.amount": after.amount, "eventKey.type": after.type, "eventKey.account": after.account } }
    );
  }

  await invalidateStatsCacheMany(input.userId, [before.date, after.date]);
  logger.info(
    { userId: input.userId, transactionId: input.transactionId, reason: input.reason, via: input.via, changedFields },
    "Transaction corrected"
  );
  // Moving it to the account the user chose teaches that account the
  // message's digits (unless another account already uses them).
  if (input.changes.accountId) {
    await learnDigitsFromCapture(input.userId, updated as { account?: Types.ObjectId; sourceCapture?: Types.ObjectId }, { force: true });
  }
  return { transaction: updated, correction };
}

async function voidTransaction(input: CorrectInput) {
  const txn = await loadCorrectable(input.userId, input.transactionId);
  const before = snapshotOf(txn);

  await deleteTransaction(input.userId, input.transactionId, input.actor);
  const updated = await Transaction.findOneAndUpdate(
    { _id: txn._id, user: input.userId },
    {
      $set: { reviewStatus: "voided", reviewedAt: new Date(), reviewedBy: input.userId },
      ...(input.capturedMessageId ? { $addToSet: { captures: input.capturedMessageId } } : {}),
    },
    { new: true }
  ).lean();

  const lastBlock = await LedgerBlock.findOne({
    user: input.userId,
    scope: "transaction",
    entityId: input.transactionId,
  })
    .sort({ sequence: -1 })
    .select("sequence")
    .lean<{ sequence: number }>();

  const correction = await TransactionCorrection.create({
    user: input.userId,
    transaction: txn._id,
    capturedMessage: input.capturedMessageId,
    before,
    after: null,
    changedFields: ["voided"],
    reason: input.reason,
    note: input.note,
    via: input.via,
    correctedBy: input.via === "system" ? undefined : input.userId,
    balanceEffects: [{ account: before.account, delta: -balanceEffect(before.type, before.amount) }],
    ledgerSequence: lastBlock?.sequence,
  });

  logger.info({ userId: input.userId, transactionId: input.transactionId, reason: input.reason }, "Transaction voided");
  return { transaction: updated, correction };
}

export async function confirmTransaction(userId: string, transactionId: string, actor: AuthUser) {
  await connectDB();
  if (!Types.ObjectId.isValid(transactionId)) throw new ReconcileError("NOT_FOUND", "Transaction not found");
  const before = await Transaction.findOne({ _id: transactionId, user: userId, isDeleted: { $ne: true } }).lean<{
    reviewStatus?: string | null;
  }>();
  if (!before) throw new ReconcileError("NOT_FOUND", "Transaction not found");
  if (!before.reviewStatus) {
    throw new ReconcileError("INVALID_STATE", "Only auto-captured transactions need review");
  }

  const after = await Transaction.findOneAndUpdate(
    { _id: transactionId, user: userId, isDeleted: { $ne: true } },
    { $set: { reviewStatus: "confirmed", reviewedAt: new Date(), reviewedBy: userId } },
    { new: true }
  ).lean<{ account?: Types.ObjectId; sourceCapture?: Types.ObjectId }>();
  await appendLedgerBlock({ userId, scope: "transaction", entityId: transactionId, action: "update", before, after, actor });
  // Confirming an account found by bank name teaches its digits.
  if (after) await learnDigitsFromCapture(userId, after);
  return after;
}
