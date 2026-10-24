import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Notification from "@/models/Notification";
import User from "@/models/User";
import logger from "@/lib/logger";
import { sendPushToUser } from "@/lib/push";
import { formatCurrency } from "@/lib/utils";
import { listBudgetsWithSpend } from "@/lib/budget-service";
import { getReviewCounts } from "@/lib/reconcile/inbox";
import { getSpendLimitSettings, limitOn, type LimitHistoryEntry } from "@/lib/spend-limit";
import { getTransactionActivityDate } from "@/lib/transaction-activity";
import {
  DEFAULT_TIME_ZONE,
  dayWindow,
  isValidTimeZone,
  localDate,
  localDateKey,
  localHour,
  localMidnight,
} from "@/lib/spend-limit-time";
import {
  DEFAULT_WEEKLY_REVIEW_SETTINGS,
  getWeeklyReviewSettings,
  type WeeklyReviewSettings,
} from "@/lib/weekly-review-settings";

// A weekly look back: what was spent, how it compares with the week before,
// where it went, and how the budgets and the daily spend limit held up. The
// week runs Monday to Sunday on the user's own clock (preferences.timezone).
// summarizeWeek and buildHighlights are pure so they are tested with fixtures;
// getWeeklyReview reads the database around them. Served by GET
// /api/integrations/weekly-review and GET /api/weekly-review, and sent as a
// notification by sendWeeklyReviews (opt in, preferences.weeklyReview).
//
// Rules shared with the rest of the app: transfers are neither income nor
// spending, a confirmed refund comes off what was spent (not onto income), and
// recurring installments only count once they are paid (stats-service.ts). The
// spend limit result follows the spend limit's own definition (spend-limit.ts):
// expenses that are not recurring bills and not in an excluded category, judged
// against the limit that was in force on each day.

export const WEEK_STARTS_ON = 1; // Monday
export const REVIEW_FROM_HOUR = 9;
const MAX_TOP = 3;

export class WeeklyReviewError extends Error {
  constructor(
    public code: "INVALID_WEEK" | "FUTURE_WEEK",
    message: string
  ) {
    super(message);
  }
}

export type ReviewRow = {
  _id?: unknown;
  type: "income" | "expense" | "transfer";
  amount: number;
  category: string;
  description?: string | null;
  date: Date;
  paidAt?: Date;
  installmentStatus?: string;
  recurringId?: unknown;
  refundStatus?: string | null;
  reviewStatus?: string | null;
};

export type SpendLimitContext = {
  dailyAmount: number | null;
  history: LimitHistoryEntry[];
  excludeCategories: string[];
};

export type WeekSummary = {
  totals: {
    spent: number;
    income: number;
    net: number;
    previousSpent: number;
    change: { amount: number; percent: number | null };
  };
  topCategories: Array<{ category: string; total: number; share: number }>;
  topMerchants: Array<{ merchant: string; total: number; count: number }>;
  biggestExpense: { id: string | null; amount: number; description: string | null; category: string; date: string } | null;
  days: Array<{ date: string; spent: number }>;
  noSpendDays: number;
  spendLimit: { dailyAmount: number | null; daysWithin: number; daysOver: number; daysTracked: number } | null;
};

/** The start of each of the seven local days of the week starting at `weekStart`, plus the end of the last. */
export function dayStarts(weekStart: Date, timeZone: string): Date[] {
  const { year, month, day } = localDate(new Date(weekStart.getTime() + 12 * 60 * 60 * 1000), timeZone);
  return Array.from({ length: 8 }, (_, i) => localMidnight(timeZone, year, month, day + i));
}

const isRefund = (r: ReviewRow) => r.type === "income" && r.refundStatus === "confirmed";

function inWindow(r: ReviewRow, from: Date, to: Date) {
  const at = getTransactionActivityDate(r).getTime();
  return at >= from.getTime() && at < to.getTime();
}

function totalsOf(rows: ReviewRow[]) {
  let spent = 0;
  let income = 0;
  for (const r of rows) {
    if (r.type === "expense") spent += r.amount;
    else if (isRefund(r)) spent -= r.amount;
    else if (r.type === "income") income += r.amount;
  }
  return { spent, income };
}

/**
 * Builds the numbers for one week from rows covering it and the week before.
 * `now` decides which days are over: only finished days count towards no-spend
 * days and the spend limit result, so a week in progress is not judged early.
 */
export function summarizeWeek(
  rows: ReviewRow[],
  opts: { weekStart: Date; weekEnd: Date; prevStart: Date; timeZone: string; now: Date; limit: SpendLimitContext | null }
): WeekSummary {
  const { weekStart, weekEnd, prevStart, timeZone, now, limit } = opts;
  const usable = rows.filter((r) => r.type !== "transfer" && r.reviewStatus !== "voided");
  const thisWeek = usable.filter((r) => inWindow(r, weekStart, weekEnd));
  const lastWeek = usable.filter((r) => inWindow(r, prevStart, weekStart));

  const { spent, income } = totalsOf(thisWeek);
  const previousSpent = totalsOf(lastWeek).spent;
  const changeAmount = spent - previousSpent;

  const starts = dayStarts(weekStart, timeZone);
  const dayIndex = (r: ReviewRow) => {
    const at = getTransactionActivityDate(r).getTime();
    for (let i = 0; i < 7; i++) if (at < starts[i + 1].getTime()) return i;
    return 6;
  };
  const perDay = Array.from({ length: 7 }, () => 0);
  for (const r of thisWeek) {
    if (r.type === "expense") perDay[dayIndex(r)] += r.amount;
    else if (isRefund(r)) perDay[dayIndex(r)] -= r.amount;
  }
  const finished = starts.slice(1, 8).map((end) => end.getTime() <= now.getTime());
  const noSpendDays = perDay.filter((v, i) => finished[i] && v <= 0).length;

  const byCategory = new Map<string, number>();
  for (const r of thisWeek) {
    if (r.type === "expense") byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amount);
    else if (isRefund(r)) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) - r.amount);
  }
  const topCategories = [...byCategory.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOP)
    .map(([category, total]) => ({ category, total, share: spent > 0 ? Math.round((total / spent) * 100) : 0 }));

  const merchants = new Map<string, { merchant: string; total: number; count: number }>();
  for (const r of thisWeek) {
    const name = r.type === "expense" ? r.description?.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    const m = merchants.get(key) ?? { merchant: name, total: 0, count: 0 };
    m.total += r.amount;
    m.count += 1;
    merchants.set(key, m);
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.total - a.total).slice(0, MAX_TOP);

  const biggest = thisWeek.filter((r) => r.type === "expense").sort((a, b) => b.amount - a.amount)[0];

  let spendLimit: WeekSummary["spendLimit"] = null;
  if (limit && (limit.dailyAmount !== null || limit.history.length > 0)) {
    const excluded = new Set(limit.excludeCategories);
    let daysWithin = 0;
    let daysOver = 0;
    for (let i = 0; i < 7; i++) {
      if (!finished[i]) continue;
      const allowed = limitOn(limit.history, { dailyAmount: limit.dailyAmount, weeklyAmount: null }, starts[i]).dailyAmount;
      if (allowed === null) continue;
      const counted = thisWeek
        .filter(
          (r) =>
            r.type === "expense" &&
            !r.recurringId &&
            !excluded.has(r.category) &&
            r.date.getTime() >= starts[i].getTime() &&
            r.date.getTime() < starts[i + 1].getTime()
        )
        .reduce((sum, r) => sum + r.amount, 0);
      if (counted <= allowed) daysWithin += 1;
      else daysOver += 1;
    }
    if (daysWithin + daysOver > 0) {
      spendLimit = { dailyAmount: limit.dailyAmount, daysWithin, daysOver, daysTracked: daysWithin + daysOver };
    }
  }

  return {
    totals: {
      spent,
      income,
      net: income - spent,
      previousSpent,
      change: { amount: changeAmount, percent: previousSpent > 0 ? Math.round((changeAmount / previousSpent) * 100) : null },
    },
    topCategories,
    topMerchants,
    biggestExpense: biggest
      ? {
          id: biggest._id ? String(biggest._id) : null,
          amount: biggest.amount,
          description: biggest.description ?? null,
          category: biggest.category,
          date: getTransactionActivityDate(biggest).toISOString(),
        }
      : null,
    days: perDay.map((v, i) => ({ date: localDateKey(starts[i], timeZone), spent: v })),
    noSpendDays,
    spendLimit,
  };
}

/** One or two plain-language lines, most telling first. Pure. */
export function buildHighlights(s: WeekSummary, currency = "INR"): string[] {
  const out: string[] = [];
  const { spent, previousSpent, change } = s.totals;
  if (spent <= 0 && previousSpent <= 0) return ["No spending recorded this week."];

  if (previousSpent > 0 && change.percent !== null && Math.abs(change.percent) >= 10) {
    const amount = formatCurrency(Math.abs(change.amount), currency);
    out.push(
      change.amount < 0
        ? `You spent ${amount} less than the week before (down ${Math.abs(change.percent)}%).`
        : `You spent ${amount} more than the week before (up ${change.percent}%).`
    );
  }
  if (s.spendLimit) {
    const { daysOver, daysTracked } = s.spendLimit;
    out.push(
      daysOver === 0
        ? daysTracked === 1
          ? "You stayed within your daily limit."
          : "You stayed within your daily limit every day."
        : `You went over your daily limit on ${daysOver} ${daysOver === 1 ? "day" : "days"}.`
    );
  }
  if (s.noSpendDays >= 2) out.push(`${s.noSpendDays} days with no spending.`);
  const top = s.topCategories[0];
  if (top && top.share >= 30) out.push(`${top.category} was ${top.share}% of your spending.`);
  return out.slice(0, 2);
}

export type WeeklyReview = WeekSummary & {
  week: { start: string; end: string; startDate: string; endDate: string; timeZone: string; isComplete: boolean };
  budgets: {
    month: number;
    year: number;
    asOf: string;
    total: number;
    over: number;
    near: number;
    items: Array<{ category: string; spent: number; limit: number; percent: number }>;
  } | null;
  unreviewed: number;
  highlights: string[];
  settings: WeeklyReviewSettings;
};

async function userClock(userId: string) {
  const user = await User.findById(userId).select("preferences.timezone").lean<{ preferences?: { timezone?: string } }>();
  const tz = user?.preferences?.timezone;
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

const WEEK_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The review for one week. `week` is any date (YYYY-MM-DD) inside the wanted
 * week; without it the last completed week. A week that has not started yet is
 * refused, and the week in progress is returned with isComplete false.
 */
export async function getWeeklyReview(userId: string, opts: { week?: string | null; now?: Date } = {}): Promise<WeeklyReview> {
  await connectDB();
  const now = opts.now ?? new Date();
  const timeZone = await userClock(userId);

  let win = dayWindow(now, timeZone, WEEK_STARTS_ON);
  if (opts.week) {
    const m = WEEK_PARAM.exec(opts.week);
    const probe = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    if (!m || !probe || Number.isNaN(probe.getTime()) || probe.getUTCDate() !== Number(m[3]) || probe.getUTCMonth() !== Number(m[2]) - 1) {
      throw new WeeklyReviewError("INVALID_WEEK", "week must be a date like 2026-10-19");
    }
    const noon = new Date(localMidnight(timeZone, Number(m[1]), Number(m[2]), Number(m[3])).getTime() + 12 * 60 * 60 * 1000);
    win = dayWindow(noon, timeZone, WEEK_STARTS_ON);
    if (win.weekStart.getTime() > now.getTime()) throw new WeeklyReviewError("FUTURE_WEEK", "That week has not started yet");
  } else {
    win = dayWindow(new Date(win.weekStart.getTime() - 1), timeZone, WEEK_STARTS_ON);
  }
  const { weekStart, weekEnd } = win;
  const prevStart = dayWindow(new Date(weekStart.getTime() - 1), timeZone, WEEK_STARTS_ON).weekStart;

  const inRange = { $gte: prevStart, $lt: weekEnd };
  const [rows, limitDoc, settings, counts] = await Promise.all([
    Transaction.find({
      user: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
      reviewStatus: { $ne: "voided" },
      type: { $in: ["income", "expense"] },
      $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
      $or: [{ date: inRange }, { paidAt: inRange }],
    })
      .select("type amount category description date paidAt installmentStatus recurringId refundStatus reviewStatus")
      .lean<ReviewRow[]>(),
    getSpendLimitSettings(userId),
    getWeeklyReviewSettings(userId),
    getReviewCounts(userId),
  ]);

  const limit: SpendLimitContext | null = limitDoc
    ? {
        dailyAmount: limitDoc.dailyAmount ?? null,
        excludeCategories: limitDoc.excludeCategories ?? [],
        history: (limitDoc.limitHistory ?? []).map((h) => ({
          from: new Date(h.from).toISOString(),
          dailyAmount: h.dailyAmount ?? null,
          weeklyAmount: h.weeklyAmount ?? null,
        })),
      }
    : null;

  const summary = summarizeWeek(rows, { weekStart, weekEnd, prevStart, timeZone, now, limit });

  const last = localDate(new Date(weekEnd.getTime() - 1), timeZone);
  const active = (await listBudgetsWithSpend(userId, last.year, last.month)).filter((b) => b.isActive);
  const budgets: WeeklyReview["budgets"] = active.length
    ? (() => {
        const items = active
          .map((b) => ({
            category: b.category,
            spent: b.spent,
            limit: b.effectiveLimit,
            percent: b.effectiveLimit > 0 ? Math.round((b.spent / b.effectiveLimit) * 100) : 0,
            alertAt: b.alertAt ?? 80,
          }))
          .sort((a, b) => b.percent - a.percent);
        return {
          month: last.month,
          year: last.year,
          asOf: now.toISOString(),
          total: items.length,
          over: items.filter((i) => i.spent > i.limit).length,
          near: items.filter((i) => i.spent <= i.limit && i.percent >= i.alertAt).length,
          items: items.slice(0, MAX_TOP).map(({ category, spent, limit: l, percent }) => ({ category, spent, limit: l, percent })),
        };
      })()
    : null;

  return {
    week: {
      start: weekStart.toISOString(),
      end: weekEnd.toISOString(),
      startDate: localDateKey(weekStart, timeZone),
      endDate: localDateKey(new Date(weekEnd.getTime() - 1), timeZone),
      timeZone,
      isComplete: weekEnd.getTime() <= now.getTime(),
    },
    ...summary,
    budgets,
    unreviewed: counts.needsReview,
    highlights: buildHighlights(summary),
    settings,
  };
}

/** The dedup key a user's review notification is sent under, one per week. */
export function reviewKey(startDate: string) {
  return `weekly-review:${startDate}`;
}

/**
 * Sends one user's review notification when it is their chosen weekday and
 * 09:00 has passed on their clock, for the last completed week, once. A week
 * with no spending and no income sends nothing. Returns how many were created.
 */
export async function sendWeeklyReviewForUser(
  userId: string,
  settings: WeeklyReviewSettings,
  now = new Date(),
  knownTimeZone?: string
): Promise<number> {
  const timeZone = knownTimeZone ?? (await userClock(userId));
  if (localDate(now, timeZone).dayOfWeek !== settings.day) return 0;
  if (localHour(now, timeZone) < REVIEW_FROM_HOUR) return 0;

  const review = await getWeeklyReview(userId, { now });
  if (review.totals.spent === 0 && review.totals.income === 0) return 0;
  const key = reviewKey(review.week.startDate);
  const seen = await Notification.findOne({ user: userId, "meta.dedupKey": key }).select("_id").lean();
  if (seen) return 0;

  const title = "Your week in review";
  const body = [`You spent ${formatCurrency(review.totals.spent)} last week.`, review.highlights[0]].filter(Boolean).join(" ");
  // Created before the push, so a retry after a crash cannot send it twice. A unique index on (user, dedupKey)
  // for weekly review rows (see the Notification model) makes the claim atomic: two runs at the same moment
  // (the timer and the cron route) cannot both create it, and the loser stops here.
  try {
    await Notification.create({
      user: userId,
      type: "system",
      title,
      body,
      meta: { dedupKey: key, kind: "weekly_review", weekStart: review.week.startDate },
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return 0;
    throw err;
  }
  void sendPushToUser(userId, { title, body, url: "/dashboard" }).catch((err) =>
    logger.error({ err }, "weekly review push failed")
  );
  return 1;
}

let reviewsRunning = false;

/**
 * Timer and cron entry. One run at a time per process (the timer and the cron route can overlap). The user
 * query carries the time zone, and the weekday and hour are checked in memory, so a user whose time is not
 * up costs no further query.
 */
export async function sendWeeklyReviews(now = new Date()): Promise<{ checked: number; sent: number; skipped?: true }> {
  if (reviewsRunning) return { checked: 0, sent: 0, skipped: true };
  reviewsRunning = true;
  try {
    await connectDB();
    const users = await User.find({ "preferences.weeklyReview.enabled": true, isActive: { $ne: false } })
      .select("preferences.weeklyReview preferences.timezone")
      .lean<Array<{ _id: { toString(): string }; preferences?: { weeklyReview?: { day?: number }; timezone?: string } }>>();
    let sent = 0;
    for (const u of users) {
      try {
        const day = u.preferences?.weeklyReview?.day ?? DEFAULT_WEEKLY_REVIEW_SETTINGS.day;
        const tz = u.preferences?.timezone;
        const timeZone = tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
        if (localDate(now, timeZone).dayOfWeek !== day || localHour(now, timeZone) < REVIEW_FROM_HOUR) continue;
        sent += await sendWeeklyReviewForUser(u._id.toString(), { enabled: true, day }, now, timeZone);
      } catch (err) {
        logger.error({ err, userId: u._id.toString() }, "weekly review failed for user");
      }
    }
    return { checked: users.length, sent };
  } finally {
    reviewsRunning = false;
  }
}
