import { getRangeStats, type MonthRef } from "@/lib/stats-service";

// Savings rate: the share of income that was not spent, per month, with the
// average and a trend. Built on the same month totals as every other stat
// (getRangeStats), so transfers between accounts never count (they are neither
// income nor expense) and a confirmed refund comes off spending, not onto
// income. Amounts are paise; rates are fractions (0.25 = 25%), 4 decimals.

export interface SavingsPoint {
  year: number;
  month: number;
  income: number;
  expense: number;
  /** income - expense; negative when more was spent than earned. */
  saved: number;
  /** saved / income, or null when there was no income to compare with. */
  rate: number | null;
}

export type SavingsTrend = "up" | "down" | "flat" | null;

export interface SavingsRateView {
  /** Oldest first, one entry per requested month. */
  months: SavingsPoint[];
  /** The latest month (the one in progress). */
  current: SavingsPoint;
  /** Totals over all the months asked for. */
  average: { income: number; expense: number; saved: number; rate: number | null };
  trend: SavingsTrend;
}

export function ratio(saved: number, income: number): number | null {
  if (income <= 0) return null;
  return Math.round((saved / income) * 10000) / 10000;
}

export function savingsPoint(ref: MonthRef, income: number, expense: number): SavingsPoint {
  const saved = income - expense;
  return { year: ref.year, month: ref.month, income, expense, saved, rate: ratio(saved, income) };
}

// Latest 3 months against the 3 before them, using months that had income.
// A change of more than 2 points counts as a move. null when either side has
// no month with income to compare.
export function savingsTrend(points: SavingsPoint[]): SavingsTrend {
  const withRate = points.filter((p) => p.rate !== null);
  if (withRate.length < 2) return null;
  const recent = withRate.slice(-3);
  const earlier = withRate.slice(-6, -3);
  if (earlier.length === 0) {
    // Fewer than 4 months with income: compare the last month with the first.
    const diff = (recent[recent.length - 1].rate as number) - (recent[0].rate as number);
    return diff > 0.02 ? "up" : diff < -0.02 ? "down" : "flat";
  }
  const avg = (xs: SavingsPoint[]) => xs.reduce((s, p) => s + (p.rate as number), 0) / xs.length;
  const diff = avg(recent) - avg(earlier);
  return diff > 0.02 ? "up" : diff < -0.02 ? "down" : "flat";
}

// The last `count` months ending at the month of `now`, oldest first.
export function lastMonths(count: number, now: Date = new Date()): MonthRef[] {
  const refs: MonthRef[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    refs.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return refs;
}

export async function getSavingsRate(userId: string, count = 6, now: Date = new Date()): Promise<SavingsRateView> {
  const refs = lastMonths(count, now);
  const history = await getRangeStats(userId, refs);
  const byKey = new Map(history.map((h) => [`${h.year}-${h.month}`, h.stats]));
  const months = refs.map((r) => {
    const stats = byKey.get(`${r.year}-${r.month}`);
    return savingsPoint(r, stats?.income ?? 0, stats?.expense ?? 0);
  });
  const income = months.reduce((s, p) => s + p.income, 0);
  const expense = months.reduce((s, p) => s + p.expense, 0);
  return {
    months,
    current: months[months.length - 1],
    average: { income, expense, saved: income - expense, rate: ratio(income - expense, income) },
    trend: savingsTrend(months),
  };
}
