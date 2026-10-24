import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import SpendLimit from "@/models/SpendLimit";
import Transaction from "@/models/Transaction";
import Notification from "@/models/Notification";
import User from "@/models/User";
import logger from "@/lib/logger";
import { sendPushToUser } from "@/lib/push";
import { listBudgetsWithSpend } from "@/lib/budget-service";
import {
  spendLimitUpdateSchema,
  type LimitBar,
  type LimitHistoryEntry,
  type SpendLimitStatus,
  type SpendLimitUpdate,
} from "@/features/budgets/schemas/spend-limit.schema";
import { dayWindow, DEFAULT_TIME_ZONE, isValidTimeZone, localHour } from "@/lib/spend-limit-time";
import { lockBaseCurrency } from "@/lib/base-currency";

// Daily and weekly spend limits. "Spend" is expenses only: transfers are a
// different transaction type, recurring bills (EMI, rent, subscriptions) are
// left out because they are planned and shown separately, and categories the
// user excluded are skipped. Limits are soft: they warn, they never block.

export { spendLimitUpdateSchema, type SpendLimitUpdate, type LimitBar, type LimitHistoryEntry, type SpendLimitStatus };

type SpendLimitDoc = {
  dailyAmount?: number;
  weeklyAmount?: number;
  alertAt: number;
  excludeCategories: string[];
  rollover: boolean;
  pausedUntil?: Date;
  limitHistory?: Array<{ from: Date; dailyAmount?: number | null; weeklyAmount?: number | null }>;
};

const EPOCH = new Date(0);

type Amounts = { dailyAmount: number | null; weeklyAmount: number | null };

/**
 * The daily and weekly amounts that were in force at `date`: the last history
 * entry that starts at or before it. With no history the current amounts count
 * for every day. Pure, so past-day views (streaks, calendars) can reuse it.
 */
export function limitOn(history: LimitHistoryEntry[], current: Amounts, date: Date): Amounts {
  if (history.length === 0) return current;
  let found = history[0];
  for (const entry of history) {
    if (new Date(entry.from).getTime() <= date.getTime()) found = entry;
    else break;
  }
  return { dailyAmount: found.dailyAmount, weeklyAmount: found.weeklyAmount };
}

function historyOf(doc: SpendLimitDoc | null): LimitHistoryEntry[] {
  return (doc?.limitHistory ?? []).map((h) => ({
    from: new Date(h.from).toISOString(),
    dailyAmount: h.dailyAmount ?? null,
    weeklyAmount: h.weeklyAmount ?? null,
  }));
}

/**
 * The history after the amounts change to `next` on the local day starting at
 * `dayStart`. The first change records what was in force before it (from the
 * epoch), so earlier days keep their limit. A second change on the same day
 * replaces that day's entry, and an entry that matches the one before it is
 * dropped.
 */
export function recordLimitChange(
  history: LimitHistoryEntry[],
  before: Amounts,
  next: Amounts,
  dayStart: Date
): LimitHistoryEntry[] {
  const out = history.length ? history.map((h) => ({ ...h })) : [{ from: EPOCH.toISOString(), ...before }];
  const last = out[out.length - 1];
  if (new Date(last.from).getTime() >= dayStart.getTime()) out.pop();
  const prev = out[out.length - 1];
  if (prev && prev.dailyAmount === next.dailyAmount && prev.weeklyAmount === next.weeklyAmount) return out;
  out.push({ from: dayStart.toISOString(), ...next });
  return out;
}

function bar(spent: number, limit: number | null): LimitBar {
  if (limit === null) return { spent, limit: null, left: null, percent: null };
  return { spent, limit, left: limit - spent, percent: limit > 0 ? Math.round((spent / limit) * 100) : null };
}

async function getUserClock(userId: string) {
  const user = await User.findById(userId).select("preferences.timezone preferences.weekStartsOn").lean<{
    preferences?: { timezone?: string; weekStartsOn?: number };
  }>();
  const tz = user?.preferences?.timezone;
  return {
    timeZone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
    weekStartsOn: user?.preferences?.weekStartsOn ?? 0,
  };
}

export async function getSpendLimitSettings(userId: string) {
  await connectDB();
  return SpendLimit.findOne({ user: userId }).lean<SpendLimitDoc | null>();
}

export async function updateSpendLimit(userId: string, input: SpendLimitUpdate, now = new Date()) {
  await connectDB();
  if (typeof input.dailyAmount === "number" || typeof input.weeklyAmount === "number") {
    await lockBaseCurrency(userId);
  }
  const existing = await getSpendLimitSettings(userId);
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (input.dailyAmount === null) unset.dailyAmount = 1;
  else if (input.dailyAmount !== undefined) set.dailyAmount = input.dailyAmount;
  if (input.weeklyAmount === null) unset.weeklyAmount = 1;
  else if (input.weeklyAmount !== undefined) set.weeklyAmount = input.weeklyAmount;
  if (input.alertAt !== undefined) set.alertAt = input.alertAt;
  if (input.excludeCategories !== undefined) set.excludeCategories = [...new Set(input.excludeCategories)];
  if (input.rollover !== undefined) set.rollover = input.rollover;
  if (input.pausedUntil === null) unset.pausedUntil = 1;
  else if (input.pausedUntil !== undefined) set.pausedUntil = new Date(input.pausedUntil);

  // A change to the amounts applies from today, not to days already lived.
  const before: Amounts = { dailyAmount: existing?.dailyAmount ?? null, weeklyAmount: existing?.weeklyAmount ?? null };
  const next: Amounts = {
    dailyAmount: input.dailyAmount === undefined ? before.dailyAmount : input.dailyAmount,
    weeklyAmount: input.weeklyAmount === undefined ? before.weeklyAmount : input.weeklyAmount,
  };
  if (next.dailyAmount !== before.dailyAmount || next.weeklyAmount !== before.weeklyAmount) {
    const clock = await getUserClock(userId);
    const { dayStart } = dayWindow(now, clock.timeZone, clock.weekStartsOn);
    set.limitHistory = recordLimitChange(historyOf(existing), before, next, dayStart).map((h) => ({
      from: new Date(h.from),
      ...(h.dailyAmount !== null ? { dailyAmount: h.dailyAmount } : {}),
      ...(h.weeklyAmount !== null ? { weeklyAmount: h.weeklyAmount } : {}),
    }));
  }

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  await SpendLimit.findOneAndUpdate({ user: userId }, update, { upsert: true, setDefaultsOnInsert: true });
  return getSpendLimitStatus(userId, now);
}

async function spentWindows(userId: string, excludeCategories: string[], from: Date, to: Date, bounds: {
  dayStart: Date;
  weekStart: Date;
  yesterdayStart: Date;
}) {
  const rows = await Transaction.aggregate<{ today: number; week: number; yesterday: number }>([
    {
      $match: {
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        reviewStatus: { $ne: "voided" },
        type: "expense",
        recurringId: { $exists: false },
        ...(excludeCategories.length ? { category: { $nin: excludeCategories } } : {}),
        date: { $gte: from, $lt: to },
      },
    },
    {
      $group: {
        _id: null,
        today: { $sum: { $cond: [{ $gte: ["$date", bounds.dayStart] }, "$amount", 0] } },
        week: { $sum: { $cond: [{ $gte: ["$date", bounds.weekStart] }, "$amount", 0] } },
        yesterday: {
          $sum: {
            $cond: [{ $and: [{ $gte: ["$date", bounds.yesterdayStart] }, { $lt: ["$date", bounds.dayStart] }] }, "$amount", 0],
          },
        },
      },
    },
  ]);
  return rows[0] ?? { today: 0, week: 0, yesterday: 0 };
}

async function computeSafeToSpend(userId: string, win: ReturnType<typeof dayWindow>) {
  const budgets = (await listBudgetsWithSpend(userId, win.year, win.month)).filter((b) => b.isActive);
  if (budgets.length === 0) return null;
  const monthLeft = budgets.reduce((sum, b) => sum + b.effectiveLimit - b.spent, 0);

  const upcoming = await Transaction.aggregate<{ total: number }>([
    {
      $match: {
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        type: "expense",
        recurringId: { $exists: true },
        installmentStatus: { $in: ["upcoming", "overdue"] },
        date: { $lt: win.monthEnd },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const bills = upcoming[0]?.total ?? 0;
  return Math.max(0, Math.floor((monthLeft - bills) / win.daysLeftInMonth));
}

export async function getSpendLimitStatus(userId: string, now = new Date()): Promise<SpendLimitStatus> {
  await connectDB();
  const [doc, clock] = await Promise.all([getSpendLimitSettings(userId), getUserClock(userId)]);
  const settings: SpendLimitDoc = doc ?? { alertAt: 80, excludeCategories: [], rollover: false };
  const win = dayWindow(now, clock.timeZone, clock.weekStartsOn);

  const from = new Date(Math.min(win.weekStart.getTime(), win.yesterdayStart.getTime()));
  const [spent, safeToSpend] = await Promise.all([
    spentWindows(userId, settings.excludeCategories, from, win.dayEnd, win),
    computeSafeToSpend(userId, win),
  ]);

  const paused = !!settings.pausedUntil && settings.pausedUntil.getTime() > now.getTime();
  const history = historyOf(doc);
  const current: Amounts = { dailyAmount: settings.dailyAmount ?? null, weeklyAmount: settings.weeklyAmount ?? null };
  // Today's limit is the one in force today; rollover measures yesterday
  // against the limit yesterday had, not today's.
  let dailyLimit = limitOn(history, current, win.dayStart).dailyAmount;
  if (dailyLimit !== null && settings.rollover) {
    // No limit yesterday means nothing to carry over.
    const yesterdayLimit = limitOn(history, current, win.yesterdayStart).dailyAmount;
    if (yesterdayLimit !== null) dailyLimit = Math.max(0, dailyLimit + (yesterdayLimit - spent.yesterday));
  }

  return {
    settings: {
      dailyAmount: settings.dailyAmount ?? null,
      weeklyAmount: settings.weeklyAmount ?? null,
      alertAt: settings.alertAt,
      excludeCategories: settings.excludeCategories ?? [],
      rollover: settings.rollover,
      pausedUntil: settings.pausedUntil ? settings.pausedUntil.toISOString() : null,
    },
    timezone: clock.timeZone,
    paused,
    today: bar(spent.today, paused ? null : dailyLimit),
    week: bar(spent.week, paused ? null : settings.weeklyAmount ?? null),
    safeToSpend,
    history,
  };
}

// For Home and Summary: the status only when the user has set something up,
// so users without a limit pay for one indexed lookup and nothing else.
export async function getSpendLimitStatusIfConfigured(userId: string) {
  const doc = await getSpendLimitSettings(userId);
  if (!doc || (doc.dailyAmount === undefined && doc.weeklyAmount === undefined)) return null;
  return getSpendLimitStatus(userId);
}

const rupees = (cents: number) => `₹${Math.round(cents / 100).toLocaleString("en-IN")}`;

// Called after an expense is saved, same fire-and-forget pattern as
// checkBudgetAlert. One notice at the alert percentage and one at 100%, per
// day for the daily limit and per week for the weekly limit.
export async function checkSpendLimitAlert(userId: string) {
  try {
    const doc = await getSpendLimitSettings(userId);
    if (!doc || (doc.dailyAmount === undefined && doc.weeklyAmount === undefined)) return;
    const status = await getSpendLimitStatus(userId);
    if (status.paused) return;
    const clock = await getUserClock(userId);
    const win = dayWindow(new Date(), clock.timeZone, clock.weekStartsOn);

    const checks: Array<{ name: "daily" | "weekly"; bar: LimitBar; since: Date }> = [
      { name: "daily", bar: status.today, since: win.dayStart },
      { name: "weekly", bar: status.week, since: win.weekStart },
    ];
    for (const { name, bar: b, since } of checks) {
      if (b.limit === null || b.percent === null) continue;
      const level = b.percent >= 100 ? "over" : b.percent >= doc.alertAt ? "near" : null;
      if (!level) continue;
      const dedupKey = `spend-limit-${name}-${since.toISOString()}-${level}`;
      if (await Notification.exists({ user: userId, type: "budget_alert", "meta.dedupKey": dedupKey })) continue;
      const title = level === "over" ? `Over your ${name} limit` : `Close to your ${name} limit`;
      const body =
        level === "over"
          ? `You have spent ${rupees(b.spent)} of your ${rupees(b.limit)} ${name} limit.`
          : `You have used ${b.percent}% of your ${name} limit. ${rupees(Math.max(b.left ?? 0, 0))} left.`;
      await Notification.create({
        user: userId,
        type: "budget_alert",
        title,
        body,
        meta: { kind: "spend_limit", period: name, level, percent: b.percent, dedupKey },
      });
      void sendPushToUser(userId, { title, body, url: "/budgets" });
    }
  } catch (err) {
    logger.error({ err }, "Spend limit alert check failed");
  }
}

// Local hour from which the end-of-day summary may go out. A run that is late
// or skipped an hour still sends it, once, until the day ends.
export const SUMMARY_FROM_HOUR = 21;

// One "how did today go" notice per user per local day, only for users with a
// daily limit that is not paused. Returns true when it sent one.
export async function sendSpendLimitSummary(userId: string, now = new Date()) {
  const clock = await getUserClock(userId);
  if (localHour(now, clock.timeZone) < SUMMARY_FROM_HOUR) return false;

  const status = await getSpendLimitStatus(userId, now);
  const day = status.today;
  if (status.paused || day.limit === null) return false;

  const win = dayWindow(now, clock.timeZone, clock.weekStartsOn);
  const dedupKey = `spend-summary-${win.dayStart.toISOString()}`;
  if (await Notification.exists({ user: userId, type: "budget_alert", "meta.dedupKey": dedupKey })) return false;

  const title = `Today: ${rupees(day.spent)} of ${rupees(day.limit)}`;
  const body =
    day.spent === 0
      ? "No spending today. Your whole daily limit is untouched."
      : (day.left ?? 0) >= 0
        ? `You stayed under your daily limit with ${rupees(day.left ?? 0)} to spare.`
        : `You went over your daily limit by ${rupees(-(day.left ?? 0))}.`;
  await Notification.create({
    user: userId,
    type: "budget_alert",
    title,
    body,
    meta: { kind: "spend_limit_summary", spent: day.spent, limit: day.limit, dedupKey },
  });
  void sendPushToUser(userId, { title, body, url: "/budgets" });
  return true;
}

// For the scheduler: only users who set a daily limit are looked at, so it
// costs one small query plus one status check per such user.
export async function sendSpendLimitSummaries(now = new Date()) {
  await connectDB();
  const limits = await SpendLimit.find({ dailyAmount: { $exists: true } }).select("user").lean<Array<{ user: unknown }>>();
  let sent = 0;
  for (const l of limits) {
    try {
      if (await sendSpendLimitSummary(String(l.user), now)) sent += 1;
    } catch (err) {
      logger.error({ err, userId: String(l.user) }, "Spend limit summary failed");
    }
  }
  return { checked: limits.length, sent };
}
