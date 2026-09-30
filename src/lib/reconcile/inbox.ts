import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import CapturedMessage from "@/models/CapturedMessage";
import Transaction from "@/models/Transaction";
import TransactionCorrection from "@/models/TransactionCorrection";
import type { AuthUser } from "@/lib/auth-guard";
import { decryptField, type EncryptedField } from "@/lib/crypto";
import { createTransaction } from "@/lib/transaction-service";
import { CAPTURE_KEY_ENV, promoteStalePendingSms } from "@/lib/capture/ingest";
import { sourcePriorityOf } from "@/lib/capture/source";
import {
  correctTransaction,
  ReconcileError,
  type CorrectionChanges,
  type CorrectionVia,
} from "@/lib/reconcile/correct";
import logger from "@/lib/logger";

// Read side of reconcile (the review inbox, one transaction's provenance,
// correction history) and the actions on queued captures. Shared by the
// web routes and the phone's /api/integrations/review routes.

export const SOURCE_LABEL: Record<string, { label: string; priority: "primary" | "secondary" | "fallback" | "manual" }> = {
  sms: { label: "SMS (source of truth)", priority: "primary" },
  n8n: { label: "n8n (forwarded SMS)", priority: "secondary" },
  notification: { label: "App notification (lower priority, verify)", priority: "fallback" },
  manual: { label: "Added by you", priority: "manual" },
};

type RawCapture = {
  _id: Types.ObjectId;
  channel: string;
  sender?: string;
  packageName?: string;
  rawText: EncryptedField;
  receivedAt: Date;
  alsoSeenIn?: string[];
  parse?: { kind?: string; confidence?: number; fields?: Record<string, unknown> };
  outcome: string;
  reason?: string;
  status: string;
  role: string;
  transaction?: Types.ObjectId;
  duplicateOf?: Types.ObjectId;
  eventKey?: { account?: Types.ObjectId | null };
  suggestedAccount?: Types.ObjectId | null;
  createdAt: Date;
};

function safeDecrypt(field: EncryptedField): string | null {
  try {
    return decryptField(field, CAPTURE_KEY_ENV);
  } catch (err) {
    logger.error({ err }, "captured message decrypt failed");
    return null;
  }
}

export function serializeCapture(c: RawCapture) {
  const f = (c.parse?.fields ?? {}) as Record<string, unknown>;
  return {
    id: c._id.toString(),
    channel: c.channel,
    source: SOURCE_LABEL[c.channel] ?? { label: c.channel, priority: "fallback" },
    sender: c.sender ?? null,
    packageName: c.packageName ?? null,
    receivedAt: c.receivedAt,
    // Likely account for an unmatched message, to preselect when resolving.
    suggestedAccountId: c.suggestedAccount ? c.suggestedAccount.toString() : null,
    text: safeDecrypt(c.rawText),
    alsoSeenIn: c.alsoSeenIn ?? [],
    parsed: {
      kind: c.parse?.kind ?? "unknown",
      confidence: c.parse?.confidence ?? 0,
      type: (f.type as string) ?? null,
      amount: (f.amountMinor as number) ?? null,
      last4: (f.last4 as string) ?? null,
      merchant: (f.merchant as string) ?? null,
      ref: (f.ref as string) ?? null,
      date: (f.date as string | Date) ?? null,
    },
    outcome: c.outcome,
    reason: c.reason ?? null,
    status: c.status,
    role: c.role,
    transactionId: c.transaction?.toString() ?? null,
    duplicateOfId: c.duplicateOf?.toString() ?? null,
    createdAt: c.createdAt,
  };
}

type RawTxn = {
  _id: Types.ObjectId;
  account: Types.ObjectId;
  type: string;
  amount: number;
  currency?: string;
  category: string;
  description?: string;
  date: Date;
  source?: string;
  reviewStatus?: string | null;
  sourceCapture?: Types.ObjectId;
  captures?: Types.ObjectId[];
  isDeleted?: boolean;
};

async function accountNames(userId: string, ids: (Types.ObjectId | string | undefined)[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const accounts = await Account.find({ _id: { $in: unique }, user: userId }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(accounts.map((a) => [a._id.toString(), a.name]));
}

function serializeTxn(t: RawTxn, names: Map<string, string>) {
  return {
    id: t._id.toString(),
    accountId: t.account.toString(),
    accountName: names.get(t.account.toString()) ?? null,
    type: t.type,
    amount: t.amount,
    currency: t.currency ?? "INR",
    category: t.category,
    description: t.description ?? "",
    date: t.date,
    source: t.source ?? "manual",
    sourceInfo: SOURCE_LABEL[t.source ?? "manual"] ?? SOURCE_LABEL.manual,
    reviewStatus: t.reviewStatus ?? null,
    isDeleted: Boolean(t.isDeleted),
  };
}

const unreviewedFilter = (userId: string) => ({ user: userId, isDeleted: { $ne: true }, reviewStatus: "unreviewed" });
const queuedFilter = (userId: string) => ({ user: userId, status: "pending", outcome: "queued" });
const waitingFilter = (userId: string) => ({ user: userId, outcome: "pending_sms" });

/** Lazy promotion of held notifications (see promoteStalePendingSms). */
async function promoteLazily(userId: string) {
  try {
    return (await promoteStalePendingSms({ userId })).promoted;
  } catch (err) {
    logger.error({ err, userId }, "lazy promotion failed");
    return 0;
  }
}

async function readInboxRows(userId: string) {
  return Promise.all([
    Transaction.find(unreviewedFilter(userId)).sort({ date: -1 }).limit(100).lean<RawTxn[]>(),
    CapturedMessage.find(queuedFilter(userId)).sort({ createdAt: -1 }).limit(100).lean<RawCapture[]>(),
    CapturedMessage.countDocuments(waitingFilter(userId)),
  ]);
}

/**
 * Just the three numbers, for badges and the home screen: counts only, no
 * documents fetched or decrypted.
 */
export async function getReviewCounts(userId: string) {
  await connectDB();
  const promoting = promoteLazily(userId);
  const read = () =>
    Promise.all([
      Transaction.countDocuments(unreviewedFilter(userId)),
      CapturedMessage.countDocuments(queuedFilter(userId)),
      CapturedMessage.countDocuments(waitingFilter(userId)),
    ]);
  let [[needsReview, couldntMatch, waitingForSms], promoted] = await Promise.all([read(), promoting]);
  if (promoted > 0) [needsReview, couldntMatch, waitingForSms] = await read();
  return { needsReview: Math.min(needsReview, 100), couldntMatch: Math.min(couldntMatch, 100), waitingForSms };
}

export async function getReviewInbox(userId: string) {
  await connectDB();
  // Promotion (the only way held notifications become transactions on
  // serverless hosts) runs alongside the reads instead of before them; in
  // the rare case it promoted something, read again so the result has it.
  let [[txns, queued, pendingSms], promoted] = await Promise.all([readInboxRows(userId), promoteLazily(userId)]);
  if (promoted > 0) [txns, queued, pendingSms] = await readInboxRows(userId);

  const captureIds = txns.flatMap((t) => [t.sourceCapture, ...(t.captures ?? [])]).filter(Boolean);
  const relatedTxnIds = queued.map((c) => c.transaction).filter(Boolean);
  const [captures, relatedTxns] = await Promise.all([
    CapturedMessage.find({ _id: { $in: captureIds }, user: userId }).lean<RawCapture[]>(),
    Transaction.find({ _id: { $in: relatedTxnIds }, user: userId }).lean<RawTxn[]>(),
  ]);
  const captureById = new Map(captures.map((c) => [c._id.toString(), c]));
  const names = await accountNames(userId, [...txns, ...relatedTxns].map((t) => t.account));
  const relatedById = new Map(relatedTxns.map((t) => [t._id.toString(), serializeTxn(t, names)]));

  // Lower-priority (notification) values first: they need the closest look.
  const needsReview = txns
    .map((t) => {
      const primary = t.sourceCapture ? captureById.get(t.sourceCapture.toString()) : undefined;
      const supporting = (t.captures ?? [])
        .map((cid) => captureById.get(cid.toString()))
        .filter((c): c is RawCapture => Boolean(c) && c!._id.toString() !== t.sourceCapture?.toString());
      return {
        ...serializeTxn(t, names),
        sourceCapture: primary ? serializeCapture(primary) : null,
        alsoSeenIn: supporting.map(serializeCapture),
      };
    })
    .sort((a, b) => sourcePriorityOf(a.source) - sourcePriorityOf(b.source));

  const couldntMatch = queued.map((c) => ({
    ...serializeCapture(c),
    relatedTransaction: c.transaction ? relatedById.get(c.transaction.toString()) ?? null : null,
  }));

  return {
    counts: { needsReview: needsReview.length, couldntMatch: couldntMatch.length, waitingForSms: pendingSms },
    needsReview,
    couldntMatch,
  };
}

export async function getTransactionProvenance(userId: string, transactionId: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(transactionId)) throw new ReconcileError("NOT_FOUND", "Transaction not found");
  const txn = await Transaction.findOne({ _id: transactionId, user: userId }).lean<RawTxn>();
  if (!txn) throw new ReconcileError("NOT_FOUND", "Transaction not found");

  const [captures, corrections] = await Promise.all([
    CapturedMessage.find({
      user: userId,
      $or: [{ _id: { $in: [txn.sourceCapture, ...(txn.captures ?? [])].filter(Boolean) } }, { transaction: txn._id }],
    })
      .sort({ sourcePriority: -1, receivedAt: 1 })
      .lean<RawCapture[]>(),
    TransactionCorrection.find({ user: userId, transaction: txn._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const names = await accountNames(
    userId,
    [txn.account, ...corrections.flatMap((c) => [c.before?.account, c.after?.account])].filter(Boolean)
  );

  return {
    transaction: serializeTxn(txn, names),
    sourceCaptureId: txn.sourceCapture?.toString() ?? null,
    captures: captures.map(serializeCapture),
    corrections: corrections.map((c) => serializeCorrection(c, names)),
  };
}

type RawCorrection = {
  _id: Types.ObjectId;
  transaction: Types.ObjectId;
  capturedMessage?: Types.ObjectId;
  before: Record<string, unknown> & { account?: Types.ObjectId };
  after?: (Record<string, unknown> & { account?: Types.ObjectId }) | null;
  changedFields: string[];
  reason: string;
  note?: string;
  via: string;
  balanceEffects?: { account: Types.ObjectId; delta: number }[];
  createdAt: Date;
};

function serializeCorrection(c: RawCorrection, names: Map<string, string>) {
  const snap = (s?: RawCorrection["before"] | null) =>
    s
      ? {
          amount: s.amount,
          type: s.type,
          accountId: s.account?.toString() ?? null,
          accountName: s.account ? names.get(s.account.toString()) ?? null : null,
          category: s.category,
          date: s.date,
          description: s.description,
        }
      : null;
  return {
    id: c._id.toString(),
    transactionId: c.transaction.toString(),
    capturedMessageId: c.capturedMessage?.toString() ?? null,
    before: snap(c.before),
    after: snap(c.after),
    changedFields: c.changedFields,
    reason: c.reason,
    note: c.note ?? null,
    via: c.via,
    balanceEffects: (c.balanceEffects ?? []).map((e) => ({ accountId: e.account.toString(), delta: e.delta })),
    createdAt: c.createdAt,
  };
}

export async function listCorrectionHistory(userId: string, limit = 100) {
  await connectDB();
  const corrections = await TransactionCorrection.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .lean<RawCorrection[]>();
  const txns = await Transaction.find({ _id: { $in: corrections.map((c) => c.transaction) }, user: userId })
    .select("description category type amount isDeleted")
    .lean<{ _id: Types.ObjectId; description?: string; category: string }[]>();
  const txnById = new Map(txns.map((t) => [t._id.toString(), t]));
  const names = await accountNames(
    userId,
    corrections.flatMap((c) => [c.before?.account, c.after?.account])
  );
  return corrections.map((c) => {
    const t = txnById.get(c.transaction.toString());
    return { ...serializeCorrection(c, names), transactionLabel: t?.description || t?.category || "Transaction" };
  });
}

// ── Actions on queued captures ─────────────────────────────────────────────

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), "Invalid id");

export const resolveCaptureSchema = z.discriminatedUnion("action", [
  z.object({
    // Turn a queued message into a transaction with the values the user checked.
    action: z.literal("create"),
    accountId: objectId,
    type: z.enum(["income", "expense"]),
    amount: z.number().int().positive(),
    category: z.string().trim().min(1).max(50).default("other"),
    description: z.string().trim().max(200).optional(),
    date: z.string().datetime().optional(),
    // Save the message's last four digits on the chosen account so the next
    // message from it matches automatically.
    rememberDigits: z.boolean().default(false),
  }),
  // possible_duplicate: "Same payment" (link it to the existing transaction).
  z.object({ action: z.literal("link") }),
  // source_conflict: keep the user's values, or take the SMS values.
  z.object({ action: z.literal("keep_mine"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("use_sms") }),
]);

export type ResolveCaptureInput = z.infer<typeof resolveCaptureSchema>;

async function loadPendingCapture(userId: string, captureId: string) {
  if (!Types.ObjectId.isValid(captureId)) throw new ReconcileError("NOT_FOUND", "Message not found");
  const capture = await CapturedMessage.findOne({ _id: captureId, user: userId }).lean<
    RawCapture & { sourcePriority: number }
  >();
  if (!capture) throw new ReconcileError("NOT_FOUND", "Message not found");
  if (capture.status !== "pending" || capture.outcome !== "queued") {
    throw new ReconcileError("INVALID_STATE", "This message was already handled");
  }
  return capture;
}

async function finishCapture(captureId: Types.ObjectId, userId: string, set: Record<string, unknown>) {
  await CapturedMessage.updateOne(
    { _id: captureId, user: userId },
    { $set: { status: "resolved", resolvedAt: new Date(), resolvedBy: userId, ...set } }
  );
}

function smsChanges(capture: RawCapture): CorrectionChanges {
  const f = (capture.parse?.fields ?? {}) as Record<string, unknown>;
  const accountId = capture.eventKey?.account?.toString();
  return {
    ...(typeof f.amountMinor === "number" ? { amount: f.amountMinor } : {}),
    ...(f.type === "income" || f.type === "expense" ? { type: f.type as "income" | "expense" } : {}),
    ...(accountId ? { accountId } : {}),
    ...(f.date ? { date: new Date(f.date as string).toISOString() } : {}),
    ...(typeof f.merchant === "string" ? { description: f.merchant } : {}),
  };
}

export async function resolveCapture(params: {
  userId: string;
  captureId: string;
  input: ResolveCaptureInput;
  actor: AuthUser;
  via: CorrectionVia;
}) {
  const { userId, captureId, input, actor, via } = params;
  await connectDB();
  const capture = await loadPendingCapture(userId, captureId);
  const channel = capture.channel as "sms" | "n8n" | "notification";

  if (input.action === "create") {
    const { transaction } = await createTransaction({
      userId,
      actor,
      accountId: input.accountId,
      type: input.type,
      amount: input.amount,
      currency: "INR",
      category: input.category,
      description: input.description,
      date: input.date ?? new Date(capture.receivedAt).toISOString(),
      tags: [],
      isRecurring: false,
      provenance: {
        source: channel,
        sourceCapture: captureId,
        captures: [captureId],
        // The user checked these values themselves.
        reviewStatus: "confirmed",
      },
    });
    const txnId = (transaction as { _id: Types.ObjectId })._id.toString();
    await finishCapture(capture._id, userId, { outcome: "created", role: "primary", transaction: txnId });

    const last4 = (capture.parse?.fields as { last4?: string } | undefined)?.last4;
    if (input.rememberDigits && last4) {
      await Account.updateOne({ _id: input.accountId, user: userId }, { $addToSet: { smsLastFour: last4 } });
    }
    return { transactionId: txnId };
  }

  const txnId = capture.transaction?.toString();
  if (!txnId) throw new ReconcileError("INVALID_STATE", "This message isn't linked to a transaction");
  const txn = await Transaction.findOne({ _id: txnId, user: userId, isDeleted: { $ne: true } })
    .select("source")
    .lean<{ source?: string }>();
  if (!txn) throw new ReconcileError("NOT_FOUND", "Linked transaction not found");

  if (input.action === "link") {
    // "Same payment". If this message outranks the transaction's current
    // source, its values become the ones in use.
    if (sourcePriorityOf(channel) > sourcePriorityOf(txn.source)) {
      await correctTransaction({
        userId,
        transactionId: txnId,
        changes: smsChanges(capture),
        reason: "sms_override",
        via,
        actor,
        capturedMessageId: captureId,
        sourceUpdate: { source: channel, sourceCapture: captureId },
      });
      await finishCapture(capture._id, userId, { outcome: "created", role: "primary" });
    } else {
      await Transaction.updateOne({ _id: txnId, user: userId }, { $addToSet: { captures: capture._id } });
      await finishCapture(capture._id, userId, { outcome: "duplicate", role: "supporting" });
    }
    return { transactionId: txnId };
  }

  if (input.action === "keep_mine") {
    await correctTransaction({
      userId,
      transactionId: txnId,
      changes: {},
      reason: "kept_user_values",
      note: input.note,
      via,
      actor,
      capturedMessageId: captureId,
    });
    await finishCapture(capture._id, userId, { outcome: "duplicate", role: "supporting" });
    return { transactionId: txnId };
  }

  // use_sms
  await correctTransaction({
    userId,
    transactionId: txnId,
    changes: smsChanges(capture),
    reason: "sms_override",
    via,
    actor,
    capturedMessageId: captureId,
    sourceUpdate: { source: channel, sourceCapture: captureId },
  });
  await finishCapture(capture._id, userId, { outcome: "created", role: "primary" });
  return { transactionId: txnId };
}

export async function discardCapture(userId: string, captureId: string) {
  await connectDB();
  const capture = await loadPendingCapture(userId, captureId);
  await CapturedMessage.updateOne(
    { _id: capture._id, user: userId },
    { $set: { status: "discarded", resolvedAt: new Date(), resolvedBy: userId } }
  );
}
