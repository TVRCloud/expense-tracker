// Anomaly alert rules (rules only, no ML). Pure functions and the constants
// they use, so every boundary is testable without a database. Amounts are
// minor units of the user's base currency (two-decimal bases only for now).
// src/lib/anomaly-service.ts gathers the inputs and creates the alerts.

export const LARGE_SPEND = {
  /** An expense is large when it is at least this many times the category's median. */
  factor: 3,
  /** Prior expenses in the category (last `windowDays`) needed before the rule can fire. */
  minHistory: 5,
  windowDays: 90,
  /** Never alert below this amount (1,000.00). */
  floor: 100_000,
} as const;

export const DUPLICATE_CHARGE = {
  windowMinutes: 10,
  /** Never alert below this amount (100.00): two cups of tea are not a duplicate charge. */
  floor: 10_000,
} as const;

export const CATEGORY_JUMP = {
  /** Month to date spend must be at least this many times the baseline. */
  factor: 2,
  /** ...and exceed it by at least this much (2,000.00). */
  floor: 200_000,
  /** Previous months compared, and how many of them must have spend in the category. */
  months: 3,
  minMonthsWithSpend: 2,
  /** Days of the month that must have passed before the rule can fire. */
  minElapsedDays: 5,
} as const;

/** An expense dated more than this many days before it was entered is back-filled history, not a surprise. */
export const STALE_AFTER_DAYS = 3;

export type AnomalyKind = "large_spend" | "duplicate_charge" | "category_jump";

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export type LargeSpendResult = { typical: number; threshold: number } | null;

/**
 * Rule 1. `history` is the amounts of the category's earlier expenses in the
 * last 90 days (not including this one). Null when there is too little history,
 * the amount is under the floor or under `factor` times the median.
 */
export function largeSpend(amount: number, history: number[]): LargeSpendResult {
  if (history.length < LARGE_SPEND.minHistory) return null;
  const typical = median(history);
  const threshold = Math.max(LARGE_SPEND.factor * typical, LARGE_SPEND.floor);
  return amount >= threshold ? { typical, threshold } : null;
}

export type DuplicateCandidate = {
  id: string;
  amount: number;
  date: Date;
  description?: string | null;
};

function sameDescription(a?: string | null, b?: string | null) {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  // A missing description on either side does not rule a duplicate out.
  return x === "" || y === "" || x === y;
}

/**
 * Rule 2. Finds an earlier row on the same account (the caller passes only
 * live expenses of that account) with the same amount inside the window and
 * a compatible description. Returns the nearest one in time, or null.
 */
export function duplicateOf(
  current: DuplicateCandidate,
  others: DuplicateCandidate[]
): DuplicateCandidate | null {
  if (current.amount < DUPLICATE_CHARGE.floor) return null;
  const windowMs = DUPLICATE_CHARGE.windowMinutes * 60 * 1000;
  let best: DuplicateCandidate | null = null;
  let bestGap = Infinity;
  for (const o of others) {
    if (o.id === current.id || o.amount !== current.amount) continue;
    const gap = Math.abs(current.date.getTime() - o.date.getTime());
    if (gap > windowMs || !sameDescription(current.description, o.description)) continue;
    if (gap < bestGap) {
      best = o;
      bestGap = gap;
    }
  }
  return best;
}

export type CategoryMonthSpend = {
  /** 0 is the current month, 1 the month before, and so on up to CATEGORY_JUMP.months. */
  monthsAgo: number;
  /** Spend in the first `elapsedDays` days of that month. */
  total: number;
};

export type CategoryJumpResult = { monthToDate: number; baseline: number } | null;

/**
 * Rule 3. `rows` hold, per month, the category's spend in the first
 * `elapsedDays` days of the month (so the comparison is like for like).
 * baseline is the average over the 3 previous months, a month with no
 * spend counting as zero.
 */
export function categoryJump(rows: CategoryMonthSpend[], elapsedDays: number): CategoryJumpResult {
  if (elapsedDays < CATEGORY_JUMP.minElapsedDays) return null;
  const monthToDate = rows.filter((r) => r.monthsAgo === 0).reduce((s, r) => s + r.total, 0);
  const previous = rows.filter((r) => r.monthsAgo >= 1 && r.monthsAgo <= CATEGORY_JUMP.months && r.total > 0);
  const monthsWithSpend = new Set(previous.map((r) => r.monthsAgo)).size;
  if (monthsWithSpend < CATEGORY_JUMP.minMonthsWithSpend) return null;
  const sum = previous.reduce((s, r) => s + r.total, 0);
  // Average over every previous month compared, so one busy month cannot make a normal month look like a jump.
  const baseline = Math.round(sum / CATEGORY_JUMP.months);
  if (baseline <= 0) return null;
  if (monthToDate >= CATEGORY_JUMP.factor * baseline && monthToDate - baseline >= CATEGORY_JUMP.floor) {
    return { monthToDate, baseline };
  }
  return null;
}
