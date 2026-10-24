import { addMonths, addWeeks, addYears } from "date-fns";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/spend-limit-time";

// The pure maths of the cash flow forecast (see cash-flow-forecast.ts for what
// feeds it). No database here, so it is unit tested with plain fixtures.

export const DEFAULT_FORECAST_DAYS = 30;
export const MAX_FORECAST_DAYS = 60;
export const SPEND_LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ForecastEventKind = "recurring" | "card" | "loan" | "subscription";

export type ForecastEvent = {
  /** When the money moves. Before today counts as today (overdue, still to pay). */
  date: Date;
  /** Signed: income positive, spending negative. */
  amount: number;
  label: string;
  kind: ForecastEventKind;
};

export type ForecastPoint = {
  /** The user's local calendar day, yyyy-mm-dd. */
  date: string;
  /** Balance at the end of that day. */
  balance: number;
  /** What changed over the day (events plus the daily spend). */
  change: number;
};

export type ForecastEventOut = { date: string; kind: ForecastEventKind; label: string; amount: number };

export type Forecast = {
  days: number;
  startingBalance: number;
  endBalance: number;
  lowest: { date: string; balance: number };
  goesNegative: boolean;
  firstNegativeDate: string | null;
  points: ForecastPoint[];
  events: ForecastEventOut[];
  totals: { inflows: number; outflows: number; dailySpendTotal: number };
};

export function clampDays(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return DEFAULT_FORECAST_DAYS;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_FORECAST_DAYS);
}

/** The calendar day of `date` on the wall clock of `timeZone`, as yyyy-mm-dd. */
export function localDateKey(date: Date, timeZone: string): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function keyToUtcDay(key: string): number {
  const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function utcDayToKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export type BuildForecastInput = {
  startingBalance: number;
  now: Date;
  days: number;
  timeZone: string;
  events: ForecastEvent[];
  /** Typical spend per day, applied from tomorrow on. */
  dailySpend: number;
};

/**
 * One point per day, today through the last of `days` days, each the balance at
 * the end of the day. Events dated before today fall on today; events after the
 * window are left out. The daily spend is not applied to today.
 */
export function buildForecast(input: BuildForecastInput): Forecast {
  const days = clampDays(input.days);
  const todayDay = keyToUtcDay(localDateKey(input.now, input.timeZone));
  const change = new Array<number>(days).fill(0);
  const events: ForecastEventOut[] = [];
  let inflows = 0;
  let outflows = 0;

  for (const e of input.events) {
    const offset = Math.max(keyToUtcDay(localDateKey(e.date, input.timeZone)) - todayDay, 0);
    if (offset >= days) continue;
    change[offset] += e.amount;
    if (e.amount >= 0) inflows += e.amount;
    else outflows += -e.amount;
    events.push({ date: utcDayToKey(todayDay + offset), kind: e.kind, label: e.label, amount: e.amount });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount || a.label.localeCompare(b.label));

  const spend = Math.max(Math.round(input.dailySpend), 0);
  let balance = input.startingBalance;
  let dailySpendTotal = 0;
  const points: ForecastPoint[] = [];
  let lowest = { date: utcDayToKey(todayDay), balance: Number.POSITIVE_INFINITY };
  let firstNegativeDate: string | null = null;

  for (let i = 0; i < days; i++) {
    const daySpend = i === 0 ? 0 : spend;
    dailySpendTotal += daySpend;
    const delta = change[i] - daySpend;
    balance += delta;
    const date = utcDayToKey(todayDay + i);
    points.push({ date, balance, change: delta });
    if (balance < lowest.balance) lowest = { date, balance };
    if (balance < 0 && firstNegativeDate === null) firstNegativeDate = date;
  }

  return {
    days,
    startingBalance: input.startingBalance,
    endBalance: balance,
    lowest,
    goesNegative: firstNegativeDate !== null,
    firstNegativeDate,
    points,
    events,
    totals: { inflows, outflows, dailySpendTotal },
  };
}

function nextOccurrence(cadence: string, d: Date): Date {
  switch (cadence) {
    case "weekly":
      return addWeeks(d, 1);
    case "quarterly":
      return addMonths(d, 3);
    case "yearly":
      return addYears(d, 1);
    default:
      return addMonths(d, 1);
  }
}

/** Charges of one subscription inside the window: an overdue one counts today, then the cadence repeats. */
export function subscriptionOccurrences(nextDate: Date, cadence: string, now: Date, days: number, timeZone: string): Date[] {
  const todayDay = keyToUtcDay(localDateKey(now, timeZone));
  const out: Date[] = [];
  let d = new Date(nextDate);
  let guard = 0;
  if (keyToUtcDay(localDateKey(d, timeZone)) < todayDay) {
    out.push(now);
    d = nextOccurrence(cadence, d);
  }
  while (keyToUtcDay(localDateKey(d, timeZone)) < todayDay && guard++ < 200) d = nextOccurrence(cadence, d);
  while (keyToUtcDay(localDateKey(d, timeZone)) - todayDay < days && guard++ < 400) {
    out.push(new Date(d));
    d = nextOccurrence(cadence, d);
  }
  return out;
}

