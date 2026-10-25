// The numbers behind holdings, kept pure so they are easy to test. Everything
// that touches money runs in BigInt and rounds half up, so a quantity or a
// price never goes through floating point.

export const UNIT_DECIMALS = 6;
export const PRICE_DECIMALS = 4;
export const MAX_UNITS_MICRO = 1_000_000_000_000_000; // 1e9 units
const DAY_MS = 86_400_000;
const B0 = BigInt(0);
const B2 = BigInt(2);

/** "12.5" -> 12_500_000n at 6 decimals. Null when it is not a plain non-negative decimal within `decimals`. */
export function parseDecimal(input: string, decimals: number): bigint | null {
  const m = /^(\d{1,15})(?:\.(\d{1,12}))?$/.exec(input.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1]) * BigInt(10) ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Units as stored (millionths) back to a trimmed decimal string: 12_500_000 -> "12.5". */
export function formatMicro(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000).padStart(UNIT_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n + d / B2) / d;
}

/** Units (millionths) times a price in major units with up to 4 decimals, as minor units (paise), rounded half up. */
export function valueFromPrice(unitsMicro: number, price: string): number | null {
  const scaled = parseDecimal(price, PRICE_DECIMALS);
  if (scaled === null || !Number.isSafeInteger(unitsMicro) || unitsMicro < 0) return null;
  // units = micro / 1e6, price = scaled / 1e4, minor units = units * price * 100.
  const value = divRoundHalfUp(BigInt(unitsMicro) * scaled, BigInt(100_000_000));
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

/** Gain as a percent of what was put in, one decimal, half away from zero. Null when nothing was invested. */
export function gainPercent(invested: number, current: number): number | null {
  if (invested <= 0) return null;
  const gain = BigInt(current) - BigInt(invested);
  const base = BigInt(invested);
  const tenths = gain >= B0 ? divRoundHalfUp(gain * BigInt(1000), base) : -divRoundHalfUp(-gain * BigInt(1000), base);
  return Number(tenths) / 10;
}

// ---------------------------------------------------------------------------
// Calendar days ("YYYY-MM-DD" keys)

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayKey(key: string): boolean {
  const m = DAY_KEY.exec(key);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(key: string): [number, number, number] {
  const m = DAY_KEY.exec(key);
  if (!m) throw new Error(`Not a day key: ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Whole days since 1970-01-01 for a day key. */
export function dayNumber(key: string): number {
  const [y, m, d] = parts(key);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function keyFromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function monthKey(index: number, day: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const d = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// SIP schedule

export type Sip = { amount: number; dayOfMonth: number; startDay: string; active: boolean };

/**
 * Due dates of a monthly SIP from `todayKey` for `lookaheadDays` days (today counts), at most `max` of them.
 * Occurrence k is the start month plus k months on min(dayOfMonth, last day of that month), always measured
 * from the start month, so a SIP on the 31st returns to the 31st after a short month. Dates before the start
 * day are skipped. Nothing is returned for a paused SIP.
 */
export function sipDueDates(sip: Pick<Sip, "dayOfMonth" | "startDay" | "active">, todayKey: string, lookaheadDays: number, max = 12): string[] {
  if (!sip.active || !isDayKey(sip.startDay) || !isDayKey(todayKey)) return [];
  const [sy, sm] = parts(sip.startDay);
  const [ty, tm] = parts(todayKey);
  const startIndex = sy * 12 + (sm - 1);
  const todayIndex = ty * 12 + (tm - 1);
  const horizon = dayNumber(todayKey) + Math.max(0, Math.floor(lookaheadDays));
  const out: string[] = [];
  // Start one month before today's month (when the SIP began earlier) so nothing is missed, then walk forward.
  for (let index = Math.max(startIndex, todayIndex - 1), guard = 0; guard < 400 && out.length < max; index++, guard++) {
    const key = monthKey(index, sip.dayOfMonth);
    const n = dayNumber(key);
    if (n >= horizon) break;
    if (key >= sip.startDay && key >= todayKey) out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixed deposit (simple interest, actual days over 365)

export type FixedDeposit = { principal: number; rateBps: number; startDay: string; maturityDay: string };

export type FdValue = {
  /** Interest earned to today (capped at maturity). */
  accrued: number;
  /** Principal plus the interest earned to today. */
  value: number;
  /** Principal plus the interest for the whole term. */
  maturityValue: number;
  termDays: number;
  daysToMaturity: number;
  matured: boolean;
};

/** Interest for `days` days: principal * rate * days / 365, rounded half up. */
export function simpleInterest(principal: number, rateBps: number, days: number): number {
  if (days <= 0 || rateBps <= 0 || principal <= 0) return 0;
  return Number(divRoundHalfUp(BigInt(principal) * BigInt(rateBps) * BigInt(days), BigInt(10_000) * BigInt(365)));
}

/** What a fixed deposit is worth on `todayKey`: nothing accrues before the start day or after maturity. */
export function fdValue(fd: FixedDeposit, todayKey: string): FdValue {
  const start = dayNumber(fd.startDay);
  const maturity = dayNumber(fd.maturityDay);
  const today = dayNumber(todayKey);
  const termDays = Math.max(0, maturity - start);
  const elapsed = Math.min(Math.max(0, today - start), termDays);
  const accrued = simpleInterest(fd.principal, fd.rateBps, elapsed);
  return {
    accrued,
    value: fd.principal + accrued,
    maturityValue: fd.principal + simpleInterest(fd.principal, fd.rateBps, termDays),
    termDays,
    daysToMaturity: Math.max(0, maturity - today),
    matured: today >= maturity,
  };
}
