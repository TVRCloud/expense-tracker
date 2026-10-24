import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import logger from "@/lib/logger";
import { ReconcileError } from "@/lib/reconcile/correct";
import { invalidateStatsCacheMany } from "@/lib/transaction-service";

// Refund and reversal matching. A credit that looks like the money coming back
// for an earlier expense (same merchant, the same or a smaller amount, shortly
// after) is linked to that expense instead of counting as new income, so the
// pair nets out of the stats and the budget. Linking never touches balances:
// the credit already raised the account balance when it was recorded.
//
// The link lives on the income row: refundOf is the expense, refundStatus is
// suggested (found automatically, waiting for the user), confirmed (counts
// against the expense in the stats) or rejected (never suggested again). A
// confirmed link also carries the original's category over to the refund.

/** How far back from the refund an original expense may be. */
export const REFUND_WINDOW_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
// Words that say "refund" or "company", not which merchant it was.
const NOISE = new Set([
  "refund", "refunded", "reversal", "reversed", "credit", "credited", "from", "upi", "pvt", "ltd", "limited",
  "india", "pay", "payments", "payment", "online", "the",
]);
// Descriptions the capture code falls back to when no merchant was found:
// two of them say nothing about being the same merchant.
const GENERIC = new Set(["captured", "captured payment"]);

export function normalizeMerchant(value: string | undefined | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !NOISE.has(word))
    .join(" ");
}

export function merchantsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (!x || !y || GENERIC.has(x) || GENERIC.has(y)) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.includes(short);
}

type TxnRow = {
  _id: Types.ObjectId;
  account: Types.ObjectId;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency?: string;
  category: string;
  subcategory?: string;
  description?: string;
  date: Date;
  recurringId?: Types.ObjectId;
  refundOf?: Types.ObjectId;
  refundStatus?: "suggested" | "confirmed" | "rejected" | null;
  refundPriorCategory?: string;
  reviewStatus?: string | null;
  isDeleted?: boolean;
};

const SELECT = "account type amount currency category subcategory description date recurringId refundOf refundStatus refundPriorCategory reviewStatus isDeleted";

export const refundConfirmSchema = z
  .object({ originalId: z.string().refine((v) => Types.ObjectId.isValid(v), "Invalid id").optional() })
  .strict();

async function accountNames(userId: string, ids: Types.ObjectId[]) {
  const unique = [...new Set(ids.map(String))];
  const accounts = await Account.find({ _id: { $in: unique }, user: userId })
    .select("name")
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(accounts.map((a) => [a._id.toString(), a.name]));
}

function serializeOriginal(t: TxnRow, names: Map<string, string>) {
  return {
    id: t._id.toString(),
    accountId: t.account.toString(),
    accountName: names.get(t.account.toString()) ?? null,
    amount: t.amount,
    currency: t.currency ?? "INR",
    category: t.category,
    description: t.description ?? "",
    date: t.date,
  };
}

function serializeRefund(t: TxnRow, original: TxnRow | null, names: Map<string, string>) {
  return {
    id: t._id.toString(),
    accountId: t.account.toString(),
    accountName: names.get(t.account.toString()) ?? null,
    amount: t.amount,
    currency: t.currency ?? "INR",
    category: t.category,
    description: t.description ?? "",
    date: t.date,
    status: t.refundStatus ?? null,
    original: original ? serializeOriginal(original, names) : null,
  };
}

/** What each expense has already been refunded, counting confirmed links only. */
async function refundedTotals(userId: string, originalIds: Types.ObjectId[], exceptId?: Types.ObjectId) {
  if (originalIds.length === 0) return new Map<string, number>();
  const rows = await Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
    {
      $match: {
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        refundStatus: "confirmed",
        refundOf: { $in: originalIds },
        ...(exceptId ? { _id: { $ne: exceptId } } : {}),
      },
    },
    { $group: { _id: "$refundOf", total: { $sum: "$amount" } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.total]));
}

/**
 * Earlier expenses this credit could be the refund of, best first: an exact
 * amount before a partial one, then the same account, then the closest in
 * time. Never an expense that has already been refunded up to its amount.
 */
export async function findRefundCandidates(userId: string, refund: TxnRow, limit = 3): Promise<TxnRow[]> {
  await connectDB();
  const from = new Date(refund.date.getTime() - REFUND_WINDOW_DAYS * DAY_MS);
  const to = new Date(refund.date.getTime() + DAY_MS);
  const expenses = await Transaction.find({
    user: userId,
    isDeleted: { $ne: true },
    type: "expense",
    reviewStatus: { $ne: "voided" },
    amount: { $gte: refund.amount },
    date: { $gte: from, $lt: to },
  })
    .sort({ date: -1 })
    .limit(300)
    .select(SELECT)
    .lean<TxnRow[]>();

  const matching = expenses.filter(
    (e) => e._id.toString() !== refund._id.toString() && merchantsMatch(e.description, refund.description)
  );
  if (matching.length === 0) return [];

  const refunded = await refundedTotals(
    userId,
    matching.map((e) => e._id),
    refund._id
  );
  return matching
    .filter((e) => e.amount - (refunded.get(e._id.toString()) ?? 0) >= refund.amount)
    .sort((a, b) => {
      const exact = Number(b.amount === refund.amount) - Number(a.amount === refund.amount);
      if (exact) return exact;
      const sameAccount = Number(b.account.equals(refund.account)) - Number(a.account.equals(refund.account));
      if (sameAccount) return sameAccount;
      return Math.abs(a.date.getTime() - refund.date.getTime()) - Math.abs(b.date.getTime() - refund.date.getTime());
    })
    .slice(0, limit);
}

/**
 * Looks for the expense a freshly recorded credit refunds and, if there is
 * one, marks the credit "suggested". Does nothing for anything that is not a
 * plain credit, or that already has a link or was rejected.
 */
export async function suggestRefund(userId: string, transactionId: string) {
  await connectDB();
  const tx = await Transaction.findOne({ _id: transactionId, user: userId, isDeleted: { $ne: true } })
    .select(SELECT)
    .lean<TxnRow | null>();
  if (!tx || tx.type !== "income" || tx.recurringId || tx.refundStatus) return null;

  const [best] = await findRefundCandidates(userId, tx, 1);
  if (!best) return null;
  await Transaction.updateOne(
    { _id: tx._id, user: userId, refundStatus: null },
    { $set: { refundOf: best._id, refundStatus: "suggested" } }
  );
  return best;
}

/** Same as suggestRefund, for the capture path: a failure here must never lose the capture. */
export async function suggestRefundSafely(userId: string, transactionId: string) {
  try {
    await suggestRefund(userId, transactionId);
  } catch (err) {
    logger.error({ err, userId, transactionId }, "refund suggestion failed");
  }
}

/** Suggested matches waiting for the user, newest first. */
export async function listRefundSuggestions(userId: string) {
  await connectDB();
  const credits = await Transaction.find({
    user: userId,
    isDeleted: { $ne: true },
    type: "income",
    refundStatus: "suggested",
  })
    .sort({ date: -1 })
    .limit(100)
    .select(SELECT)
    .lean<TxnRow[]>();
  const originals = await Transaction.find({
    _id: { $in: credits.map((c) => c.refundOf).filter(Boolean) },
    user: userId,
    isDeleted: { $ne: true },
  })
    .select(SELECT)
    .lean<TxnRow[]>();
  const originalById = new Map(originals.map((o) => [o._id.toString(), o]));
  const names = await accountNames(userId, [...credits, ...originals].map((t) => t.account));
  // An original deleted since the suggestion was made leaves nothing to confirm.
  return credits
    .map((c) => ({ credit: c, original: c.refundOf ? originalById.get(c.refundOf.toString()) ?? null : null }))
    .filter((r) => r.original)
    .map((r) => serializeRefund(r.credit, r.original, names));
}

async function loadCredit(userId: string, id: string) {
  const credit = Types.ObjectId.isValid(id)
    ? await Transaction.findOne({ _id: id, user: userId, isDeleted: { $ne: true }, type: "income" })
        .select(SELECT)
        .lean<TxnRow | null>()
    : null;
  if (!credit) throw new ReconcileError("NOT_FOUND", "Credit not found");
  return credit;
}

/**
 * Links the credit to its expense: the suggested one, or `originalId` when the
 * user picks another. The refund takes the expense's category, so a refunded
 * grocery order comes off Groceries. Balances are untouched.
 */
export async function confirmRefund(userId: string, id: string, input: { originalId?: string } = {}) {
  await connectDB();
  const credit = await loadCredit(userId, id);
  if (credit.refundStatus === "confirmed") {
    throw new ReconcileError("INVALID_STATE", "This credit is already linked to an expense");
  }
  const originalId = input.originalId ?? credit.refundOf?.toString();
  if (!originalId) throw new ReconcileError("INVALID_STATE", "Say which expense this refunds");
  if (originalId === id) throw new ReconcileError("INVALID_STATE", "A credit cannot refund itself");

  const original = Types.ObjectId.isValid(originalId)
    ? await Transaction.findOne({ _id: originalId, user: userId, isDeleted: { $ne: true }, type: "expense" })
        .select(SELECT)
        .lean<TxnRow | null>()
    : null;
  if (!original) throw new ReconcileError("NOT_FOUND", "Expense not found");

  const refunded = (await refundedTotals(userId, [original._id], credit._id)).get(original._id.toString()) ?? 0;
  if (original.amount - refunded < credit.amount) {
    throw new ReconcileError("INVALID_STATE", "That expense has already been refunded");
  }

  await Transaction.updateOne(
    { _id: credit._id, user: userId },
    {
      $set: {
        refundOf: original._id,
        refundStatus: "confirmed",
        refundPriorCategory: credit.refundPriorCategory ?? credit.category,
        category: original.category,
        ...(original.subcategory ? { subcategory: original.subcategory } : {}),
      },
    }
  );
  await invalidateStatsCacheMany(userId, [credit.date]);

  const names = await accountNames(userId, [credit.account, original.account]);
  return serializeRefund({ ...credit, refundOf: original._id, refundStatus: "confirmed", category: original.category }, original, names);
}

/**
 * "Not a refund": drops a suggestion for good, or unlinks a confirmed refund
 * and gives it back the category it had. The credit is not suggested again.
 */
export async function rejectRefund(userId: string, id: string) {
  await connectDB();
  const credit = await loadCredit(userId, id);
  if (credit.refundStatus === "rejected") return serializeRefund(credit, null, new Map());
  if (credit.refundStatus !== "suggested" && credit.refundStatus !== "confirmed") {
    throw new ReconcileError("INVALID_STATE", "This credit has no refund match");
  }

  const wasConfirmed = credit.refundStatus === "confirmed";
  await Transaction.updateOne(
    { _id: credit._id, user: userId },
    {
      $set: {
        refundStatus: "rejected",
        ...(wasConfirmed && credit.refundPriorCategory ? { category: credit.refundPriorCategory } : {}),
      },
      ...(wasConfirmed ? { $unset: { refundPriorCategory: "" } } : {}),
    }
  );
  if (wasConfirmed) await invalidateStatsCacheMany(userId, [credit.date]);
  return serializeRefund(
    {
      ...credit,
      refundStatus: "rejected",
      category: wasConfirmed && credit.refundPriorCategory ? credit.refundPriorCategory : credit.category,
    },
    null,
    new Map()
  );
}

/** The suggested expense for each of these credits, keyed by credit id (reconcile inbox). */
export async function refundOriginalsFor(userId: string, credits: { _id: Types.ObjectId; refundOf?: Types.ObjectId; refundStatus?: string | null }[]) {
  const suggested = credits.filter((c) => c.refundStatus === "suggested" && c.refundOf);
  if (suggested.length === 0) return new Map<string, ReturnType<typeof serializeOriginal>>();
  const originals = await Transaction.find({
    _id: { $in: suggested.map((c) => c.refundOf) },
    user: userId,
    isDeleted: { $ne: true },
  })
    .select(SELECT)
    .lean<TxnRow[]>();
  const names = await accountNames(userId, originals.map((o) => o.account));
  const byId = new Map(originals.map((o) => [o._id.toString(), serializeOriginal(o, names)]));
  const out = new Map<string, ReturnType<typeof serializeOriginal>>();
  for (const c of suggested) {
    const original = byId.get(c.refundOf!.toString());
    if (original) out.set(c._id.toString(), original);
  }
  return out;
}
