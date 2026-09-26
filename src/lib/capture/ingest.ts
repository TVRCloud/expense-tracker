import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import CapturedMessage from "@/models/CapturedMessage";
import Loan from "@/models/Loan";
import Notification from "@/models/Notification";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
import type { AuthUser } from "@/lib/auth-guard";
import { encryptField } from "@/lib/crypto";
import { createTransaction, TransactionServiceError } from "@/lib/transaction-service";
import { createRepayment, LoanServiceError } from "@/lib/loan-service";
import { correctTransaction, ReconcileError } from "@/lib/reconcile/correct";
import { sendPushToUser } from "@/lib/push";
import logger from "@/lib/logger";
import {
  CONFIDENCE_AUTO_CREATE,
  PARSER_VERSION,
  parseCapture,
  type CaptureParse,
  type MoneyParse,
} from "@/lib/capture/parsers";
import { istDayKey } from "@/lib/capture/parsers/dates";
import {
  MATCH_WINDOW_MS,
  NOTIFICATION_HOLD_MS,
  SOURCE_PRIORITY,
  contentHashOf,
  sourcePriorityOf,
  type CaptureChannel,
} from "@/lib/capture/source";

// One ingest path for every captured bank message: the phone's SMS receiver,
// the phone's notification listener, and n8n. Routes only validate and call
// ingestCapture().
//
// Source of truth (see SOURCE_PRIORITY): SMS > n8n > app notification.
//  1. A notification is held as "pending_sms" for NOTIFICATION_HOLD_MS. If
//     the matching SMS arrives, the transaction uses the SMS values and the
//     notification is kept only as a supporting record. If no SMS arrives,
//     promoteStalePendingSms() creates the transaction from the notification,
//     flagged as lower priority.
//  2. An SMS that matches a transaction created from a lower-priority source
//     replaces its values (a system "sms_override" correction, so the old
//     values stay on record), unless the user already confirmed or corrected
//     it. Then it is queued as a "source_conflict" for the user to decide.
//  3. A lower-or-equal-priority message matching an existing transaction is a
//     duplicate and changes nothing.
//  4. A cross-channel match with an unknown account on one side is queued as
//     "possible_duplicate" instead of guessed.
//
// Nothing is ever deleted: every message stays in captured_messages.

export const CAPTURE_KEY_ENV = "CAPTURE_ENCRYPTION_KEY";

export type IngestInput = {
  user: AuthUser;
  apiKeyId?: string;
  channel: CaptureChannel;
  text: string;
  sender?: string;
  packageName?: string;
  receivedAt: Date;
  alsoSeenIn?: string[];
};

export type IngestBody = {
  status: "created" | "updated" | "queued" | "pending" | "duplicate" | "ignored";
  captureId: string;
  kind?: "transaction" | "repayment";
  id?: string;
  transactionId?: string;
  reviewItemId?: string;
  reason?: string;
  isSettled?: boolean;
};

export type IngestResult = { httpStatus: 200 | 201 | 202; body: IngestBody };

type CaptureDoc = {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  channel: CaptureChannel;
  sender?: string;
  receivedAt: Date;
  sourcePriority: number;
  outcome: string;
  role: string;
  status: string;
  transaction?: Types.ObjectId;
  parse?: { kind?: string; confidence?: number; fields?: Record<string, unknown> };
  eventKey?: {
    account?: Types.ObjectId | null;
    type?: "income" | "expense";
    amount?: number;
    ref?: string;
    at?: Date;
    hasTime?: boolean;
  };
};

const id = (v: { toString(): string } | null | undefined) => (v ? v.toString() : undefined);

function isDuplicateKey(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

async function matchAccount(userId: string, last4?: string): Promise<string | null> {
  if (!last4) return null;
  const accounts = await Account.find({
    user: userId,
    isArchived: { $ne: true },
    $or: [{ smsLastFour: last4 }, { "creditMeta.lastFourDigits": last4 }],
  })
    .select("_id")
    .limit(2)
    .lean<{ _id: Types.ObjectId }[]>();
  // Two accounts with the same last four digits: don't guess.
  return accounts.length === 1 ? accounts[0]._id.toString() : null;
}

const QUEUE_COPY: Record<string, string> = {
  unparsed: "Got a bank message that couldn't be read automatically.",
  low_confidence: "Got a bank message but wasn't sure about the details.",
  no_matching_account: "A bank message didn't match any of your accounts. Add the card or account digits to match it next time.",
  no_matching_loan: "An EMI payment message didn't match any of your loans.",
  possible_duplicate: "A payment looks like one you already have. Check whether it's the same one.",
  source_conflict: "An SMS disagrees with a transaction you already confirmed.",
};

async function queue(capture: CaptureDoc, reason: string, extra: Record<string, unknown> = {}): Promise<IngestResult> {
  await CapturedMessage.updateOne(
    { _id: capture._id },
    { $set: { outcome: "queued", status: "pending", reason, ...extra } }
  );
  const title = reason === "source_conflict" ? "SMS doesn't match your transaction" : "Payment needs review";
  const body = QUEUE_COPY[reason] ?? "A captured message needs review.";
  await Notification.create({
    user: capture.user,
    type: "system",
    title,
    body,
    meta: { captureId: capture._id.toString(), href: "/reconcile" },
  });
  void sendPushToUser(capture.user.toString(), { title, body, url: "/reconcile" });

  return {
    httpStatus: 202,
    body: { status: "queued", captureId: capture._id.toString(), reviewItemId: capture._id.toString(), reason },
  };
}

// Only a time written in the message is precise. A time taken from when the
// phone received it can be minutes or hours late (delayed SMS), so those
// captures match by IST day instead.
function eventAt(parse: MoneyParse, receivedAt: Date) {
  return parse.date ? { at: parse.date, hasTime: parse.hasTime } : { at: receivedAt, hasTime: false };
}

type Match = { capture: CaptureDoc; certain: boolean };

/** Same payment on a different channel? See the rules at the top of the file. */
async function findCrossChannelMatch(capture: CaptureDoc): Promise<Match | null> {
  const key = capture.eventKey;
  if (!key?.amount || !key.type || !key.at) return null;
  const at = new Date(key.at).getTime();
  const dayMs = 36 * 60 * 60 * 1000;

  // Same amount and direction, or the same bank reference (then the amounts
  // may disagree, which is exactly when a higher-priority SMS should win).
  const sameEvent: Record<string, unknown>[] = [{ "eventKey.amount": key.amount, "eventKey.type": key.type }];
  if (key.ref) sameEvent.push({ "eventKey.ref": key.ref });

  const candidates = await CapturedMessage.find({
    user: capture.user,
    _id: { $ne: capture._id },
    channel: { $ne: capture.channel },
    role: "primary",
    $and: [
      { $or: sameEvent },
      {
        $or: [
          { outcome: { $in: ["created", "pending_sms"] }, status: { $ne: "discarded" } },
          { outcome: "queued", status: "pending" },
        ],
      },
    ],
    "eventKey.at": { $gte: new Date(at - dayMs), $lte: new Date(at + dayMs) },
  }).lean<CaptureDoc[]>();

  let best: (Match & { gap: number }) | null = null;
  for (const c of candidates) {
    const other = c.eventKey!;
    if (key.ref && other.ref && key.ref !== other.ref) continue;
    const sameRef = Boolean(key.ref && other.ref && key.ref === other.ref);
    if (!sameRef && other.amount !== key.amount) continue;

    const otherAt = new Date(other.at!).getTime();
    const gap = Math.abs(otherAt - at);
    const timeOk =
      sameRef ||
      (key.hasTime && other.hasTime ? gap <= MATCH_WINDOW_MS : istDayKey(new Date(at)) === istDayKey(new Date(otherAt)));
    if (!timeOk) continue;

    const a = id(key.account);
    const b = id(other.account);
    if (a && b && a !== b) continue;
    const certain = sameRef || Boolean(a && b && a === b);

    if (!best || (certain && !best.certain) || (certain === best.certain && gap < best.gap)) {
      best = { capture: c, certain, gap };
    }
  }
  return best ? { capture: best.capture, certain: best.certain } : null;
}

function descriptionOf(parse: MoneyParse) {
  return parse.merchant ?? parse.bankName ?? "Captured payment";
}

async function createFromCapture(
  user: AuthUser,
  capture: CaptureDoc,
  parse: MoneyParse,
  accountId: string | null,
  supporting: string[] = []
): Promise<IngestResult> {
  if (!accountId) return queue(capture, parse.last4 ? "no_matching_account" : "low_confidence");
  if (parse.confidence < CONFIDENCE_AUTO_CREATE) return queue(capture, "low_confidence");

  const captureId = capture._id.toString();
  try {
    const { transaction } = await createTransaction({
      userId: user.id,
      actor: user,
      accountId,
      type: parse.type,
      amount: parse.amountMinor,
      currency: parse.currency,
      category: "other",
      description: descriptionOf(parse),
      note: `Auto-captured from ${capture.channel === "notification" ? "an app notification" : capture.channel === "n8n" ? "n8n" : "SMS"}`,
      date: (parse.date ?? capture.receivedAt).toISOString(),
      tags: [],
      isRecurring: false,
      provenance: {
        source: capture.channel,
        sourceCapture: captureId,
        captures: [captureId, ...supporting],
        reviewStatus: "unreviewed",
      },
    });
    const txnId = (transaction as { _id: Types.ObjectId })._id.toString();
    await CapturedMessage.updateOne(
      { _id: capture._id },
      { $set: { outcome: "created", status: "resolved", resolvedAt: new Date(), transaction: txnId } }
    );
    if (supporting.length) {
      await CapturedMessage.updateMany({ _id: { $in: supporting } }, { $set: { transaction: txnId } });
    }
    return {
      httpStatus: 201,
      body: { status: "created", kind: "transaction", id: txnId, transactionId: txnId, captureId },
    };
  } catch (err) {
    // The matched account was archived/removed between matching and create.
    // Anything else is unexpected and falls through to processing_error.
    if (err instanceof TransactionServiceError && err.code === "ACCOUNT_NOT_FOUND") {
      return queue(capture, "no_matching_account");
    }
    throw err;
  }
}

async function markSupporting(capture: CaptureDoc, primary: CaptureDoc, transactionId?: string): Promise<IngestResult> {
  await CapturedMessage.updateOne(
    { _id: capture._id },
    {
      $set: {
        outcome: "duplicate",
        role: "supporting",
        duplicateOf: primary._id,
        status: "resolved",
        resolvedAt: new Date(),
        ...(transactionId ? { transaction: transactionId } : {}),
      },
    }
  );
  if (transactionId) {
    await Transaction.updateOne({ _id: transactionId }, { $addToSet: { captures: capture._id } });
  }
  return {
    httpStatus: 200,
    body: { status: "duplicate", captureId: capture._id.toString(), transactionId },
  };
}

/** Values a higher-priority capture would set on a matched transaction. */
function overrideChanges(parse: MoneyParse, accountId: string | null) {
  return {
    amount: parse.amountMinor,
    type: parse.type,
    ...(accountId ? { accountId } : {}),
    ...(parse.date ? { date: parse.date.toISOString() } : {}),
    ...(parse.merchant ? { description: parse.merchant } : {}),
  };
}

async function handleMatch(
  user: AuthUser,
  capture: CaptureDoc,
  parse: MoneyParse,
  accountId: string | null,
  match: Match
): Promise<IngestResult> {
  const other = match.capture;
  const outranks = capture.sourcePriority > other.sourcePriority;

  // A lower-priority message that hasn't become a transaction yet: a
  // notification waiting for its SMS, or one sitting in the review queue.
  // This higher-priority message wins.
  if ((other.outcome === "pending_sms" || other.outcome === "queued") && outranks) {
    // A queued item with an unknown account might be a different payment:
    // create from this message, and ask about the queued one instead of
    // guessing. A held notification is exactly what this SMS was expected
    // for, so it's always merged.
    if (other.outcome === "queued" && !match.certain) {
      const result = await createFromCapture(user, capture, parse, accountId);
      if (result.body.transactionId) {
        await CapturedMessage.updateOne(
          { _id: other._id, status: "pending" },
          { $set: { reason: "possible_duplicate", transaction: result.body.transactionId, duplicateOf: capture._id } }
        );
      }
      return result;
    }

    const claimed = await CapturedMessage.findOneAndUpdate(
      { _id: other._id, outcome: other.outcome, status: "pending" },
      {
        $set: {
          outcome: "duplicate",
          role: "supporting",
          duplicateOf: capture._id,
          status: "resolved",
          resolvedAt: new Date(),
        },
      },
      { new: true }
    );
    if (claimed) return createFromCapture(user, capture, parse, accountId, [other._id.toString()]);
    // Lost a race with promotion; continue against whatever it became.
    const reloaded = await CapturedMessage.findById(other._id).lean<CaptureDoc>();
    if (!reloaded?.transaction) return createFromCapture(user, capture, parse, accountId);
    other.transaction = reloaded.transaction;
    other.outcome = reloaded.outcome;
  } else if (other.outcome === "queued" || other.outcome === "pending_sms") {
    // Equal or lower priority than something already waiting: record it as
    // supporting and let the waiting item carry the decision.
    return markSupporting(capture, other);
  }

  if (!match.certain) {
    // Maybe the same payment, maybe a different one with the same amount:
    // ask rather than risk dropping a real payment.
    return queue(capture, "possible_duplicate", {
      duplicateOf: other._id,
      ...(other.transaction ? { transaction: other.transaction } : {}),
    });
  }

  const txn = other.transaction
    ? await Transaction.findOne({ _id: other.transaction, user: user.id }).lean<{
        _id: Types.ObjectId;
        source?: string;
        amount: number;
        type: string;
        account: Types.ObjectId;
        isDeleted?: boolean;
        reviewStatus?: string | null;
      }>()
    : null;

  // No live transaction to compare against (e.g. the user voided it as not
  // a transaction): never recreate it from a copy.
  if (!txn || txn.isDeleted) return markSupporting(capture, other, id(txn?._id));

  const txnId = txn._id.toString();
  if (capture.sourcePriority <= sourcePriorityOf(txn.source)) {
    return markSupporting(capture, other, txnId);
  }

  const valuesDiffer =
    txn.amount !== parse.amountMinor ||
    txn.type !== parse.type ||
    Boolean(accountId && accountId !== txn.account.toString());

  if (txn.reviewStatus === "confirmed" || txn.reviewStatus === "corrected") {
    if (valuesDiffer) {
      return queue(capture, "source_conflict", { role: "supporting", duplicateOf: other._id, transaction: txnId });
    }
    // Same values: the SMS just becomes the source of truth.
    await Transaction.updateOne(
      { _id: txnId },
      { $set: { source: capture.channel, sourceCapture: capture._id }, $addToSet: { captures: capture._id } }
    );
  } else {
    try {
      await correctTransaction({
        userId: user.id,
        transactionId: txnId,
        changes: overrideChanges(parse, accountId),
        reason: "sms_override",
        via: "system",
        actor: user,
        capturedMessageId: capture._id.toString(),
        sourceUpdate: { source: capture.channel, sourceCapture: capture._id.toString() },
      });
    } catch (err) {
      if (!(err instanceof ReconcileError)) throw err;
      return markSupporting(capture, other, txnId);
    }
  }

  await CapturedMessage.updateOne(
    { _id: capture._id },
    { $set: { outcome: "created", role: "primary", status: "resolved", resolvedAt: new Date(), transaction: txnId } }
  );
  await CapturedMessage.updateOne(
    { _id: other._id },
    { $set: { role: "supporting", duplicateOf: capture._id } }
  );
  return {
    httpStatus: 200,
    body: { status: "updated", captureId: capture._id.toString(), transactionId: txnId, id: txnId, kind: "transaction" },
  };
}

async function decideMoney(
  user: AuthUser,
  capture: CaptureDoc,
  parse: MoneyParse,
  accountId: string | null,
  { promoting }: { promoting: boolean }
): Promise<IngestResult> {
  const match = await findCrossChannelMatch(capture);
  if (match) return handleMatch(user, capture, parse, accountId, match);

  if (capture.channel === "notification" && !promoting) {
    await CapturedMessage.updateOne({ _id: capture._id }, { $set: { outcome: "pending_sms", status: "pending" } });
    return { httpStatus: 202, body: { status: "pending", captureId: capture._id.toString(), reason: "waiting_for_sms" } };
  }
  return createFromCapture(user, capture, parse, accountId);
}

async function decideLoan(user: AuthUser, capture: CaptureDoc, parse: Extract<CaptureParse, { kind: "loan_emi_payment" }>) {
  const loan = await Loan.findOne({
    user: user.id,
    isDeleted: { $ne: true },
    externalLoanId: parse.externalLoanId,
  }).lean<{ _id: Types.ObjectId }>();
  if (!loan) return queue(capture, "no_matching_loan");

  try {
    const { repayment, isSettled } = await createRepayment({
      loanId: loan._id.toString(),
      userId: user.id,
      actor: user,
      amount: parse.amountMinor,
      date: capture.receivedAt,
      note: `Auto-captured from ${capture.channel === "n8n" ? "n8n" : "SMS"}${parse.period ? ` — ${parse.period}` : ""}`,
    });
    const repaymentId = (repayment as { _id: Types.ObjectId })._id.toString();
    await CapturedMessage.updateOne(
      { _id: capture._id },
      { $set: { outcome: "created", status: "resolved", resolvedAt: new Date(), repayment: repaymentId } }
    );
    return {
      httpStatus: 201 as const,
      body: { status: "created" as const, kind: "repayment" as const, id: repaymentId, isSettled, captureId: capture._id.toString() },
    };
  } catch (err) {
    if (err instanceof LoanServiceError) return queue(capture, "no_matching_loan");
    throw err;
  }
}

export async function ingestCapture(input: IngestInput): Promise<IngestResult> {
  await connectDB();
  await promoteStalePendingSms({ userId: input.user.id }).catch((err) =>
    logger.error({ err, userId: input.user.id }, "lazy pending-SMS promotion failed")
  );

  const parse = parseCapture(input.text, input.receivedAt);
  const money = parse.kind === "money" ? parse : null;
  const accountId = money ? await matchAccount(input.user.id, money.last4) : null;

  let capture: CaptureDoc;
  try {
    const doc = await CapturedMessage.create({
      user: input.user.id,
      channel: input.channel,
      apiKey: input.apiKeyId,
      sender: input.sender,
      packageName: input.packageName,
      rawText: encryptField(input.text, CAPTURE_KEY_ENV),
      receivedAt: input.receivedAt,
      contentHash: contentHashOf(input.text),
      alsoSeenIn: input.alsoSeenIn ?? [],
      parse: { kind: parse.kind, parserId: parse.parserId, version: PARSER_VERSION, confidence: parse.confidence, fields: parse },
      eventKey: money
        ? { account: accountId, type: money.type, amount: money.amountMinor, ref: money.ref, ...eventAt(money, input.receivedAt) }
        : undefined,
      sourcePriority: SOURCE_PRIORITY[input.channel],
      outcome: "processing",
    });
    capture = doc.toObject() as CaptureDoc;
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Identical text seen before (any channel, any time): never a second entry.
    const existing = await CapturedMessage.findOne({
      user: input.user.id,
      contentHash: contentHashOf(input.text),
    }).lean<CaptureDoc>();
    return {
      httpStatus: 200,
      body: { status: "duplicate", captureId: id(existing?._id) ?? "", transactionId: id(existing?.transaction) },
    };
  }

  try {
    return await decide(input, capture, parse, accountId);
  } catch (err) {
    // Never leave a message stuck in "processing": a retry would only get
    // "duplicate" back (same content hash), so the payment would be lost.
    // Put it in the review queue instead, then surface the error.
    await CapturedMessage.updateOne(
      { _id: capture._id, outcome: "processing" },
      { $set: { outcome: "queued", status: "pending", reason: "processing_error" } }
    ).catch(() => undefined);
    throw err;
  }
}

async function decide(
  input: IngestInput,
  capture: CaptureDoc,
  parse: CaptureParse,
  accountId: string | null
): Promise<IngestResult> {
  if (parse.kind === "ignored") {
    await CapturedMessage.updateOne(
      { _id: capture._id },
      { $set: { outcome: "ignored", reason: parse.reason, status: "resolved", resolvedAt: new Date() } }
    );
    return { httpStatus: 200, body: { status: "ignored", captureId: capture._id.toString(), reason: parse.reason } };
  }
  if (parse.kind === "unknown") return queue(capture, "unparsed");
  if (parse.kind === "loan_emi_payment") return decideLoan(input.user, capture, parse);
  return decideMoney(input.user, capture, parse, accountId, { promoting: false });
}

/**
 * Notifications whose SMS never came: after NOTIFICATION_HOLD_MS they become
 * transactions on their own (source "notification", unreviewed), or go to
 * the review queue. Runs on a timer in server.ts and lazily at the start of
 * every ingest and review read.
 */
export async function promoteStalePendingSms({ userId, now = new Date() }: { userId?: string; now?: Date } = {}) {
  await connectDB();
  const cutoff = new Date(now.getTime() - NOTIFICATION_HOLD_MS);
  const stale = await CapturedMessage.find({
    outcome: "pending_sms",
    createdAt: { $lte: cutoff },
    ...(userId ? { user: userId } : {}),
  })
    .select("_id")
    .limit(200)
    .lean<{ _id: Types.ObjectId }[]>();

  let promoted = 0;
  for (const { _id } of stale) {
    // Claim it so two promoters (timer + lazy) never both create it.
    const claimed = await CapturedMessage.findOneAndUpdate(
      { _id, outcome: "pending_sms" },
      { $set: { outcome: "processing" } },
      { new: true }
    ).lean<CaptureDoc>();
    if (!claimed) continue;

    const owner = await User.findOne({ _id: claimed.user, isActive: { $ne: false } })
      .select("name email role")
      .lean<{ _id: Types.ObjectId; name: string; email: string; role: string }>();
    if (!owner) continue;
    const actor: AuthUser = { id: owner._id.toString(), name: owner.name, email: owner.email, role: owner.role };

    const fields = claimed.parse?.fields as unknown as MoneyParse | undefined;
    if (!fields || fields.kind !== "money") {
      await queue(claimed, "unparsed");
      continue;
    }
    const parse: MoneyParse = { ...fields, date: fields.date ? new Date(fields.date) : undefined };
    await decideMoney(actor, claimed, parse, id(claimed.eventKey?.account) ?? null, { promoting: true });
    promoted += 1;
  }
  return { promoted };
}
