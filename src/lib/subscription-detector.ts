import { createHash } from "crypto";
import { addDays, addMonths, addYears } from "date-fns";

// Finds repeating charges in expense history: the same merchant, a similar
// amount and a steady gap. Pure functions, no database: the service in
// subscription-service.ts feeds it transactions and merges the user's
// confirm and dismiss decisions on top.

export type SubscriptionCadence = "weekly" | "monthly" | "quarterly" | "yearly";

export interface Charge {
  date: Date;
  amount: number; // cents
  description?: string | null;
  category: string;
  account: string;
}

export interface DetectedSubscription {
  id: string;
  key: string;
  merchant: string;
  category: string;
  accountId: string;
  cadence: SubscriptionCadence;
  amount: number; // cents, the typical recent charge
  lastAmount: number; // cents
  firstDate: Date;
  lastDate: Date;
  nextDate: Date;
  occurrences: number;
  monthlyCost: number; // cents
  yearlyCost: number; // cents
  active: boolean;
}

interface CadenceRule {
  nominalDays: number;
  minGap: number;
  maxGap: number;
  perYear: number;
  minCharges: number;
  next: (d: Date) => Date;
}

const RULES: Record<SubscriptionCadence, CadenceRule> = {
  weekly: { nominalDays: 7, minGap: 5, maxGap: 9, perYear: 52, minCharges: 4, next: (d) => addDays(d, 7) },
  monthly: { nominalDays: 30, minGap: 25, maxGap: 35, perYear: 12, minCharges: 3, next: (d) => addMonths(d, 1) },
  quarterly: { nominalDays: 91, minGap: 80, maxGap: 102, perYear: 4, minCharges: 3, next: (d) => addMonths(d, 3) },
  yearly: { nominalDays: 365, minGap: 350, maxGap: 380, perYear: 1, minCharges: 2, next: (d) => addYears(d, 1) },
};

// Share of the gaps that must fit the cadence, and of the amounts that must
// sit near the median, for a group to count. Tolerates one skipped month or
// one price change in a longer history.
const GAP_FIT = 0.75;
const AMOUNT_FIT = 0.75;
const AMOUNT_BAND = { low: 0.8, high: 1.25 };

// Words that bank descriptions add around the merchant name.
const NOISE = new Set([
  "upi", "pos", "txn", "ref", "payment", "pay", "debit", "card", "ach", "imps", "neft", "mandate",
  "autopay", "pvt", "ltd", "limited", "india", "ecom", "online", "to", "from", "via", "the",
]);

/** A steady key for a merchant: lowercase letters only, noise words dropped, first three words. */
export function merchantKey(description: string | null | undefined): string {
  if (!description) return "";
  const words = description
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w));
  return words.slice(0, 3).join(" ");
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayGaps(dates: Date[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(Math.round((dates[i].getTime() - dates[i - 1].getTime()) / DAY_MS));
  return gaps;
}

function pickCadence(gaps: number[]): SubscriptionCadence | null {
  const mid = median(gaps);
  for (const [name, rule] of Object.entries(RULES) as [SubscriptionCadence, CadenceRule][]) {
    if (mid < rule.minGap || mid > rule.maxGap) continue;
    const fit = gaps.filter((g) => g >= rule.minGap && g <= rule.maxGap).length / gaps.length;
    if (fit >= GAP_FIT) return name;
  }
  return null;
}

export function subscriptionId(key: string): string {
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function detectSubscriptions(charges: Charge[], now: Date = new Date()): DetectedSubscription[] {
  const groups = new Map<string, Charge[]>();
  for (const c of charges) {
    const k = merchantKey(c.description);
    if (!k || c.amount <= 0) continue;
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }

  const found: DetectedSubscription[] = [];
  for (const [k, list] of groups) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    if (list.length < 2) continue;
    const cadence = pickCadence(dayGaps(list.map((c) => c.date)));
    if (!cadence) continue;
    const rule = RULES[cadence];
    if (list.length < rule.minCharges) continue;

    const amounts = list.map((c) => c.amount);
    const mid = median(amounts);
    const near = amounts.filter((a) => a >= mid * AMOUNT_BAND.low && a <= mid * AMOUNT_BAND.high).length / amounts.length;
    if (near < AMOUNT_FIT) continue;

    const last = list[list.length - 1];
    const recent = amounts.slice(-3);
    const amount = Math.round(median(recent));
    const nextDate = rule.next(last.date);
    const grace = Math.max(5, Math.round(rule.nominalDays * 0.25));
    const key = `${k}|${cadence}`;
    found.push({
      id: subscriptionId(key),
      key,
      merchant: (last.description ?? k).trim(),
      category: last.category,
      accountId: last.account,
      cadence,
      amount,
      lastAmount: last.amount,
      firstDate: list[0].date,
      lastDate: last.date,
      nextDate,
      occurrences: list.length,
      monthlyCost: Math.round((amount * rule.perYear) / 12),
      yearlyCost: amount * rule.perYear,
      active: addDays(nextDate, grace).getTime() >= now.getTime(),
    });
  }
  return found.sort((a, b) => b.yearlyCost - a.yearlyCost);
}
