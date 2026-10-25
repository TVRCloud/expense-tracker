import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import logger from "@/lib/logger";
import Anomaly from "@/models/Anomaly";
import Notification from "@/models/Notification";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
import { sendPushToUser } from "@/lib/push";
import { addUserTag } from "@/lib/transaction-service";
import type { AuthUser } from "@/lib/auth-guard";
import { getBaseCurrency } from "@/lib/base-currency";
import { formatMinor } from "@/lib/money-format";
import { activityDateAddFields } from "@/lib/transaction-activity";
import { DEFAULT_TIME_ZONE, isValidTimeZone, localDate, localMidnight } from "@/lib/spend-limit-time";
import { DEFAULT_ANOMALY_SETTINGS, isMuted, type AnomalySettings } from "@/lib/anomaly-settings";
import { categoryKey, normaliseCategories } from "@/lib/tax-settings";
import {
  CATEGORY_JUMP,
  DUPLICATE_CHARGE,
  LARGE_SPEND,
  STALE_AFTER_DAYS,
  categoryJump,
  duplicateOf,
  largeSpend,
  type AnomalyKind,
} from "@/lib/anomaly-rules";

// Anomaly alerts. `detectAnomalies` runs after a transaction is created and
// never throws: a failed check is logged and dropped, so it can neither fail
// nor slow the write. Alerts are deduplicated per cause (see the Anomaly
// model), so a retry or a second evaluation never alerts twice.
//
// Not evaluated: anything but a plain expense, transfers, recurring rows
// (scheduled bills), imports and voided or deleted rows.

export type AnomalyStatus = "open" | "dismissed" | "confirmed_mine" | "reported";
export type ResolveAction = "this_was_me" | "report" | "dismiss";

export const resolveAnomalySchema = z.object({ status: z.enum(["this_was_me", "report", "dismiss"]) }).strict();

export const anomalyListQuerySchema = z.object({
  status: z.enum(["open", "dismissed", "confirmed_mine", "reported", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
});

const STATUS_FOR_ACTION: Record<ResolveAction, AnomalyStatus> = {
  this_was_me: "confirmed_mine",
  report: "reported",
  dismiss: "dismissed",
};

/** The tag `report` puts on the expense. No colon, so it is an ordinary user tag the person can remove. */
export const REPORTED_TAG = "anomaly-reported";
const DAY_MS = 24 * 60 * 60 * 1000;
// Scheduled rows (not paid yet) never count as spending; same rule as budgets and stats.
const NOT_SCHEDULED = { $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }] };

export type CheckedTransaction = {
  _id: { toString(): string };
  account: { toString(): string };
  category: string;
  amount: number;
  date: Date;
  description?: string | null;
};

type PrefsDoc = {
  preferences?: { timezone?: string; anomalies?: { enabled?: boolean; mutedCategories?: string[] } };
} | null;

async function userContext(userId: string): Promise<{ settings: AnomalySettings; timeZone: string }> {
  const doc = await User.findById(userId).select("preferences.anomalies preferences.timezone").lean<PrefsDoc>();
  const saved = doc?.preferences?.anomalies;
  const tz = doc?.preferences?.timezone;
  return {
    settings: {
      enabled: saved?.enabled ?? DEFAULT_ANOMALY_SETTINGS.enabled,
      mutedCategories: normaliseCategories(saved?.mutedCategories ?? []),
    },
    timeZone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
  };
}

type NewAnomaly = {
  kind: AnomalyKind;
  dedupKey: string;
  transaction?: string;
  category: string;
  amount: number;
  data: Record<string, unknown>;
  title: string;
  body: string;
};

/** Creates the alert and its notification once. Returns false when this cause was already alerted. */
async function raise(userId: string, a: NewAnomaly): Promise<boolean> {
  let anomalyId: string;
  try {
    const created = await Anomaly.create({
      user: userId,
      kind: a.kind,
      transaction: a.transaction,
      category: a.category,
      amount: a.amount,
      data: a.data,
      dedupKey: a.dedupKey,
    });
    anomalyId = created._id.toString();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
  // The alert is the record and is kept whatever happens next: it shows on /alerts even when the inbox
  // notification cannot be written. Nothing retries (one background pass, and the dedupKey stops a second
  // evaluation), so a failure here is logged and the other checks and the push carry on.
  try {
    await Notification.create({
      user: userId,
      type: "system",
      title: a.title,
      body: a.body,
      meta: { kind: "anomaly", anomalyKind: a.kind, anomalyId, transactionId: a.transaction ?? null },
    });
  } catch (err) {
    logger.error({ err, userId, anomalyId }, "anomaly notification failed; the alert is kept");
  }
  // Awaited: this runs inside after() on Vercel, which may freeze once the task settles. A failure is logged.
  try {
    await sendPushToUser(userId, { title: a.title, body: a.body, url: "/alerts" });
  } catch (err) {
    logger.error({ err, userId, anomalyId }, "anomaly push failed");
  }
  return true;
}

async function checkLarge(userId: string, t: CheckedTransaction, currency: string): Promise<boolean> {
  const since = new Date(t.date.getTime() - LARGE_SPEND.windowDays * DAY_MS);
  const rows = await Transaction.find({
    user: userId,
    isDeleted: { $ne: true },
    type: "expense",
    category: t.category,
    reviewStatus: { $ne: "voided" },
    date: { $gte: since, $lt: t.date },
    _id: { $ne: t._id },
    ...NOT_SCHEDULED,
  })
    .select("amount")
    .sort({ date: -1 })
    .limit(500)
    .lean<Array<{ amount: number }>>();
  const hit = largeSpend(t.amount, rows.map((r) => r.amount));
  if (!hit) return false;
  return raise(userId, {
    kind: "large_spend",
    dedupKey: `large:${t._id.toString()}`,
    transaction: t._id.toString(),
    category: t.category,
    amount: t.amount,
    data: { typical: hit.typical, threshold: hit.threshold, factor: LARGE_SPEND.factor, sample: rows.length },
    title: `Large ${t.category} spend`,
    body: `${formatMinor(t.amount, currency)} on ${t.category}. Your usual is about ${formatMinor(hit.typical, currency)}.`,
  });
}

async function checkDuplicate(userId: string, t: CheckedTransaction, currency: string): Promise<boolean> {
  if (t.amount < DUPLICATE_CHARGE.floor) return false;
  const windowMs = DUPLICATE_CHARGE.windowMinutes * 60 * 1000;
  const rows = await Transaction.find({
    user: userId,
    account: t.account,
    isDeleted: { $ne: true },
    type: "expense",
    amount: t.amount,
    reviewStatus: { $ne: "voided" },
    date: { $gte: new Date(t.date.getTime() - windowMs), $lte: new Date(t.date.getTime() + windowMs) },
    _id: { $ne: t._id },
    ...NOT_SCHEDULED,
  })
    .select("amount date description")
    .sort({ date: -1 })
    .limit(50)
    .lean<Array<{ _id: { toString(): string }; amount: number; date: Date; description?: string }>>();
  const other = duplicateOf(
    { id: t._id.toString(), amount: t.amount, date: t.date, description: t.description },
    rows.map((r) => ({ id: r._id.toString(), amount: r.amount, date: r.date, description: r.description }))
  );
  if (!other) return false;
  return raise(userId, {
    kind: "duplicate_charge",
    // Symmetric in the two rows, so two charges saved at the same moment (each sees the other) alert once.
    dedupKey: `dup:${[t._id.toString(), other.id].sort().join(":")}`,
    transaction: t._id.toString(),
    category: t.category,
    amount: t.amount,
    data: { otherTransaction: other.id, windowMinutes: DUPLICATE_CHARGE.windowMinutes },
    title: "Possible duplicate charge",
    // No merchant text: the notification and the push show on a lock screen.
    body: `${formatMinor(t.amount, currency)} on ${t.category} was charged twice within ${DUPLICATE_CHARGE.windowMinutes} minutes.`,
  });
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Spend in the first `elapsedDays` days of the month `monthsAgo` before now, in the user's zone, refunds netted out. */
async function monthSpend(userId: string, category: string, timeZone: string, now: Date, monthsAgo: number, elapsedDays: number) {
  const p = localDate(now, timeZone);
  const index = p.year * 12 + (p.month - 1) - monthsAgo;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const start = localMidnight(timeZone, year, month, 1);
  const end = localMidnight(timeZone, year, month, Math.min(elapsedDays, daysInMonth(year, month)) + 1);
  const rows = await Transaction.aggregate<{ total: number }>([
    {
      $match: {
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        category,
        $or: [{ type: "expense" }, { type: "income", refundStatus: "confirmed" }],
        reviewStatus: { $ne: "voided" },
        // Coarse prefilter on the indexed date; a paid instalment scheduled over 90 days before it was paid can be missed.
        date: { $gte: new Date(start.getTime() - 90 * DAY_MS) },
        ...NOT_SCHEDULED,
      },
    },
    { $addFields: activityDateAddFields() },
    { $match: { activityDate: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: null,
        total: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amount", { $multiply: ["$amount", -1] }] } },
      },
    },
    { $limit: 1 },
  ]);
  return Math.max(0, rows[0]?.total ?? 0);
}

async function checkJump(userId: string, t: CheckedTransaction, currency: string, timeZone: string, now: Date): Promise<boolean> {
  const today = localDate(now, timeZone);
  const txnDay = localDate(t.date, timeZone);
  // Only this month's spending can jump; a back-dated row in an old month is history.
  if (txnDay.year !== today.year || txnDay.month !== today.month) return false;
  const elapsed = today.day;
  if (elapsed < CATEGORY_JUMP.minElapsedDays) return false;
  // Month to date first: it must beat the floor to ever fire, which spares the three earlier months in the common case.
  const monthToDate = await monthSpend(userId, t.category, timeZone, now, 0, elapsed);
  if (monthToDate < CATEGORY_JUMP.floor) return false;
  const earlier = await Promise.all(
    Array.from({ length: CATEGORY_JUMP.months }, async (_unused, i) => ({
      monthsAgo: i + 1,
      total: await monthSpend(userId, t.category, timeZone, now, i + 1, elapsed),
    }))
  );
  const hit = categoryJump([{ monthsAgo: 0, total: monthToDate }, ...earlier], elapsed);
  if (!hit) return false;
  const monthKey = `${today.year}-${String(today.month).padStart(2, "0")}`;
  return raise(userId, {
    kind: "category_jump",
    dedupKey: `jump:${categoryKey(t.category)}:${monthKey}`,
    category: t.category,
    amount: hit.monthToDate,
    data: { baseline: hit.baseline, monthToDate: hit.monthToDate, month: monthKey, elapsedDays: elapsed, factor: CATEGORY_JUMP.factor },
    title: `${t.category} is higher than usual`,
    body: `${formatMinor(hit.monthToDate, currency)} so far this month on ${t.category}, against about ${formatMinor(hit.baseline, currency)} by this point in a usual month.`,
  });
}

/**
 * Checks one new expense against the three rules and raises what fires.
 * `splitLine` rows only get the category jump (one line of a split is not a
 * purchase). Never throws.
 */
export async function detectAnomalies(
  userId: string,
  t: CheckedTransaction,
  opts: { splitLine?: boolean; now?: Date } = {}
): Promise<number> {
  try {
    await connectDB();
    const { settings, timeZone } = await userContext(userId);
    if (!settings.enabled || isMuted(settings, t.category)) return 0;
    const now = opts.now ?? new Date();
    // Back-filled history is not a surprise.
    if (now.getTime() - t.date.getTime() > STALE_AFTER_DAYS * DAY_MS) return 0;
    const currency = await getBaseCurrency(userId);
    let raised = 0;
    // One failing check (a database error while alerting) must not stop the others.
    const attempt = async (name: string, check: () => Promise<boolean>) => {
      try {
        if (await check()) raised += 1;
      } catch (err) {
        logger.error({ err, userId, check: name }, "anomaly check failed");
      }
    };
    if (!opts.splitLine) {
      await attempt("large", () => checkLarge(userId, t, currency));
      await attempt("duplicate", () => checkDuplicate(userId, t, currency));
    }
    await attempt("jump", () => checkJump(userId, t, currency, timeZone, now));
    return raised;
  } catch (err) {
    logger.error({ err, userId }, "anomaly check failed");
    return 0;
  }
}

/** Open alerts about a transaction (or the other half of a duplicate pair) go quiet once it is deleted or voided. Never throws. */
export async function retireAnomaliesForTransactions(userId: string, transactionIds: string[]): Promise<void> {
  if (transactionIds.length === 0) return;
  try {
    await connectDB();
    await Anomaly.updateMany(
      // An alert is also about the other row of a duplicate pair: with it gone there is no pair.
      {
        user: userId,
        status: "open",
        $or: [{ transaction: { $in: transactionIds } }, { "data.otherTransaction": { $in: transactionIds } }],
      },
      { $set: { status: "dismissed", resolvedAt: new Date() } }
    );
  } catch (err) {
    logger.error({ err, userId }, "retiring anomalies failed");
  }
}

export type AnomalyListStatus = AnomalyStatus | "all";

export type AnomalyView = {
  id: string;
  kind: AnomalyKind;
  status: AnomalyStatus;
  category: string;
  amount: number;
  currency: string;
  transactionId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
  resolvedAt: Date | null;
};

type AnomalyDoc = {
  _id: { toString(): string };
  kind: AnomalyKind;
  status: AnomalyStatus;
  category: string;
  amount: number;
  transaction?: { toString(): string };
  data?: Record<string, unknown>;
  createdAt: Date;
  resolvedAt?: Date;
};

function view(doc: AnomalyDoc, currency: string): AnomalyView {
  return {
    id: doc._id.toString(),
    kind: doc.kind,
    status: doc.status,
    category: doc.category,
    amount: doc.amount,
    currency,
    transactionId: doc.transaction ? doc.transaction.toString() : null,
    data: doc.data ?? {},
    createdAt: doc.createdAt,
    resolvedAt: doc.resolvedAt ?? null,
  };
}

/** Newest first; with status "all", open ones come first. limit is capped at 50. */
export async function listAnomalies(
  userId: string,
  opts: { status?: AnomalyListStatus; skip?: number; limit?: number } = {}
) {
  const status = opts.status ?? "open";
  const skip = Math.max(0, opts.skip ?? 0);
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 50);
  await connectDB();
  const match: Record<string, unknown> = { user: new Types.ObjectId(userId) };
  if (status !== "all") match.status = status;
  const [rows, total, openCount, currency] = await Promise.all([
    Anomaly.aggregate<AnomalyDoc>([
      { $match: match },
      { $addFields: { rank: { $cond: [{ $eq: ["$status", "open"] }, 0, 1] } } },
      { $sort: { rank: 1, createdAt: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { rank: 0 } },
    ]),
    Anomaly.countDocuments(match),
    Anomaly.countDocuments({ user: userId, status: "open" }),
    getBaseCurrency(userId),
  ]);
  return { data: rows.map((r) => view(r, currency)), total, openCount, skip, limit };
}

/**
 * Answers an alert; the last answer wins for the status. "report" also tags the expense
 * `anomaly-reported` through addUserTag (ledgered, refused for a row linked to a loan repayment or
 * statement payment, within the tag cap). No answer ever takes a tag off: the person removes it by hand
 * like any tag, which keeps answers free of races. The alert is answered even when the tag cannot be
 * written; `tagged` is true only when this report left the expense carrying the tag (false for any other answer, whatever the tag state).
 * Returns null when the alert is not this user's.
 */
export async function resolveAnomaly(
  userId: string,
  id: string,
  action: ResolveAction,
  actor: AuthUser
): Promise<(AnomalyView & { tagged: boolean }) | null> {
  await connectDB();
  const resolvedAt = new Date();
  const status = STATUS_FOR_ACTION[action];
  const before = await Anomaly.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: { status, resolvedAt } },
    { new: false }
  ).lean<AnomalyDoc>();
  if (!before) return null;
  let tagged = false;
  if (action === "report" && before.transaction) {
    try {
      const outcome = await addUserTag(userId, before.transaction.toString(), REPORTED_TAG, actor);
      tagged = outcome === "changed" || outcome === "unchanged";
    } catch (err) {
      logger.error({ err, userId, anomalyId: id }, "tagging a reported expense failed");
    }
  }
  return { ...view({ ...before, status, resolvedAt }, await getBaseCurrency(userId)), tagged };
}
