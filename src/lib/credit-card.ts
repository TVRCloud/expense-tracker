import { getDaysInMonth, addDays, format } from "date-fns";

export interface CardConfig {
  billingCycleDay: number;
  paymentDueDay: number;
  creditLimit: number;
  minPaymentPct: number;
}

export interface CycleDates {
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  label: string;
}

export interface DueDateStatus {
  daysUntilDue: number;
  isOverdue: boolean;
}

export interface TxnLike {
  type: string;
  amount: number;
  date: string | Date;
}

function clampDay(day: number, year: number, month: number): number {
  return Math.min(day, getDaysInMonth(new Date(year, month)));
}

/**
 * Returns the Date for a given billing cycle day in a specific year/month,
 * clamped to the actual number of days in that month.
 */
function cycleDate(day: number, year: number, month: number): Date {
  const clamped = clampDay(day, year, month);
  return new Date(year, month, clamped, 0, 0, 0, 0);
}

/**
 * Returns the current open billing cycle dates.
 *
 * Logic:
 *   The cycle CLOSES on billingCycleDay each month.
 *   If today is on or before the close day → cycle started last month's close day + 1
 *   If today is after the close day → cycle started this month's close day + 1
 */
export function getCurrentCycle(config: CardConfig, now?: Date): CycleDates {
  const today = now ?? new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();

  const closeDay = config.billingCycleDay;
  const clampedCloseToday = clampDay(closeDay, todayYear, todayMonth);

  let periodEndYear: number;
  let periodEndMonth: number;

  if (todayDay <= clampedCloseToday) {
    // Cycle closes this month
    periodEndYear = todayYear;
    periodEndMonth = todayMonth;
  } else {
    // Cycle closes next month
    if (todayMonth === 11) {
      periodEndYear = todayYear + 1;
      periodEndMonth = 0;
    } else {
      periodEndYear = todayYear;
      periodEndMonth = todayMonth + 1;
    }
  }

  const periodEnd = cycleDate(closeDay, periodEndYear, periodEndMonth);

  // Period starts the day after the previous cycle closed
  const prevCloseMonth = periodEndMonth === 0 ? 11 : periodEndMonth - 1;
  const prevCloseYear = periodEndMonth === 0 ? periodEndYear - 1 : periodEndYear;
  const prevClose = cycleDate(closeDay, prevCloseYear, prevCloseMonth);
  const periodStart = addDays(prevClose, 1);

  // Due date is a fixed calendar day each month; find its next occurrence after periodEnd
  const dueCandidateSameMonth = new Date(
    periodEndYear,
    periodEndMonth,
    clampDay(config.paymentDueDay, periodEndYear, periodEndMonth),
    0, 0, 0, 0
  );
  let dueDate: Date;
  if (dueCandidateSameMonth > periodEnd) {
    dueDate = dueCandidateSameMonth;
  } else {
    const nextMonth = periodEndMonth === 11 ? 0 : periodEndMonth + 1;
    const nextYear = periodEndMonth === 11 ? periodEndYear + 1 : periodEndYear;
    dueDate = new Date(nextYear, nextMonth, clampDay(config.paymentDueDay, nextYear, nextMonth), 0, 0, 0, 0);
  }

  return {
    periodStart,
    periodEnd,
    dueDate,
    label: format(periodEnd, "MMMM yyyy"),
  };
}

/**
 * Returns the last N closed billing cycles, newest first.
 */
export function getPastCycles(
  config: CardConfig,
  count = 12,
  now?: Date
): CycleDates[] {
  const current = getCurrentCycle(config, now);
  const cycles: CycleDates[] = [];

  // Walk backwards from the cycle before the current one
  let refEnd = addDays(current.periodStart, -1);

  for (let i = 0; i < count; i++) {
    const refYear = refEnd.getFullYear();
    const refMonth = refEnd.getMonth();
    const periodEnd = cycleDate(config.billingCycleDay, refYear, refMonth);

    const prevMonth = refMonth === 0 ? 11 : refMonth - 1;
    const prevYear = refMonth === 0 ? refYear - 1 : refYear;
    const prevClose = cycleDate(config.billingCycleDay, prevYear, prevMonth);
    const periodStart = addDays(prevClose, 1);
    const dueCandidateSameMonth = new Date(
      refYear,
      refMonth,
      clampDay(config.paymentDueDay, refYear, refMonth),
      0, 0, 0, 0
    );
    let dueDate: Date;
    if (dueCandidateSameMonth > periodEnd) {
      dueDate = dueCandidateSameMonth;
    } else {
      const nm = refMonth === 11 ? 0 : refMonth + 1;
      const ny = refMonth === 11 ? refYear + 1 : refYear;
      dueDate = new Date(ny, nm, clampDay(config.paymentDueDay, ny, nm), 0, 0, 0, 0);
    }

    cycles.push({
      periodStart,
      periodEnd,
      dueDate,
      label: format(periodEnd, "MMMM yyyy"),
    });

    refEnd = addDays(periodStart, -1);
  }

  return cycles;
}

/**
 * Sums expense transactions within [periodStart, periodEnd] inclusive.
 * Income/transfer transactions that credit the card (payments) reduce the balance.
 * Returns a positive integer in cents representing money owed.
 */
export function computeCycleBalance(
  transactions: TxnLike[],
  periodStart: Date,
  periodEnd: Date
): number {
  let balance = 0;
  for (const tx of transactions) {
    const date = typeof tx.date === "string" ? new Date(tx.date) : tx.date;
    if (date < periodStart || date > periodEnd) continue;
    if (tx.type === "expense") {
      balance += tx.amount;
    } else if (tx.type === "income") {
      // Payments into card appear as income — they reduce what's owed
      balance -= tx.amount;
    }
  }
  return Math.max(0, balance);
}

/** Returns utilization percentage (0–100). */
export function computeUtilization(balance: number, creditLimit: number): number {
  if (creditLimit <= 0) return 0;
  return Math.min(100, (balance / creditLimit) * 100);
}

/**
 * Returns a CSS color value for the utilization percentage.
 * < 30%  → "var(--green)"
 * 30–70% → "#f59e0b"
 * > 70%  → "var(--red)"
 */
export function utilizationColor(pct: number): string {
  if (pct < 30) return "var(--green)";
  if (pct < 70) return "#f59e0b";
  return "var(--red)";
}

/** Minimum payment: max(minPaymentPct% of balance, 100 cents). */
export function computeMinPayment(balance: number, minPaymentPct: number): number {
  if (balance <= 0) return 0;
  return Math.max(100, Math.ceil((balance * minPaymentPct) / 100));
}

/** Returns days until due and whether the statement is overdue. */
export function getDueDateStatus(dueDate: Date, now?: Date): DueDateStatus {
  const today = now ?? new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffMs = due.getTime() - today.getTime();
  const daysUntilDue = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return { daysUntilDue, isOverdue: daysUntilDue < 0 };
}

/**
 * Returns a human-readable hint for which statement a date falls on.
 * e.g. "This will appear on your June 2026 statement (closes Jun 25)"
 */
export function getStatementLabelForDate(date: Date, config: CardConfig): string {
  const cycle = getCurrentCycle(config, date);
  const closesLabel = format(cycle.periodEnd, "MMM d");
  return `This will appear on your ${cycle.label} statement (closes ${closesLabel})`;
}
