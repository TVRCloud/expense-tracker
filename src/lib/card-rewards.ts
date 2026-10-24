import { z } from "zod";

// Reward maths for one credit card. Pure: no database. The service in
// card-rewards-service.ts feeds it the card's transactions per billing cycle.
//
// Units
//   cashback  rate = percent of spend (1.5 means 1.5%); earned and cap are paise
//   points    rate = points per 100 rupees spent;       earned and cap are points
//
// Rounding: every transaction is rounded DOWN on its own, in integer maths
// (rates have at most two decimals, so they are held as hundredths). A
// confirmed refund takes back exactly what the same amount would have earned,
// so a full refund cancels its purchase to the paise. The cap applies to the
// net total of a billing cycle.

export const REWARD_KINDS = ["cashback", "points"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

/** Rupees of value one point is worth when the rule does not say (25 paise). */
export const DEFAULT_POINT_VALUE = 25;

const MAX_CATEGORY_RATES = 30;

function atMostTwoDecimals(n: number) {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
}

const rateField = z
  .number()
  .min(0)
  .refine(atMostTwoDecimals, "Rates have at most two decimals");

export const rewardRuleSchema = z
  .object({
    kind: z.enum(REWARD_KINDS),
    baseRate: rateField,
    categoryRates: z
      .array(
        z
          .object({
            category: z
              .string()
              .trim()
              .min(1)
              .max(40)
              .transform((c) => c.toLowerCase()),
            rate: rateField,
          })
          .strict()
      )
      .max(MAX_CATEGORY_RATES)
      .optional(),
    cap: z.number().int().min(1).nullable().optional(),
    pointValue: z.number().int().min(1).max(10000).nullable().optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const top = rule.kind === "cashback" ? 100 : 1000;
    const rates = [rule.baseRate, ...(rule.categoryRates ?? []).map((r) => r.rate)];
    if (rates.some((r) => r > top)) {
      ctx.addIssue({
        code: "custom",
        message: rule.kind === "cashback" ? "Cashback is at most 100 percent" : "Points are at most 1000 per 100 rupees",
      });
    }
    if (rule.kind === "cashback" && rule.pointValue != null) {
      ctx.addIssue({ code: "custom", path: ["pointValue"], message: "pointValue is only for points rules" });
    }
    const seen = new Set<string>();
    for (const r of rule.categoryRates ?? []) {
      if (seen.has(r.category)) {
        ctx.addIssue({ code: "custom", path: ["categoryRates"], message: `Category "${r.category}" is listed twice` });
      }
      seen.add(r.category);
    }
  });

export type RewardRuleInput = z.infer<typeof rewardRuleSchema>;

export type RewardRule = {
  kind: RewardKind;
  baseRate: number;
  categoryRates: { category: string; rate: number }[];
  cap: number | null;
  pointValue: number | null;
};

/** The stored shape (or null) as the API reports it. */
export function normalizeRule(raw: unknown): RewardRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RewardRule> & { categoryRates?: { category: string; rate: number }[] };
  if (r.kind !== "cashback" && r.kind !== "points") return null;
  return {
    kind: r.kind,
    baseRate: r.baseRate ?? 0,
    categoryRates: (r.categoryRates ?? []).map((c) => ({ category: c.category, rate: c.rate })),
    cap: r.cap ?? null,
    pointValue: r.kind === "points" ? (r.pointValue ?? null) : null,
  };
}

export type RewardTxn = {
  type: string;
  /** paise, always positive */
  amount: number;
  category: string;
  refundStatus?: string | null;
};

export type RewardCategoryLine = { category: string; rate: number; spend: number; earned: number };

export type RewardResult = {
  unit: "paise" | "points";
  spend: number;
  refunded: number;
  /** before the cap */
  uncapped: number;
  /** after the cap: what the cycle earns */
  earned: number;
  capReached: boolean;
  /** paise: cashback earned, or points times the point value */
  value: number;
  byCategory: RewardCategoryLine[];
};

function rateFor(rule: RewardRule, category: string): number {
  const key = category.trim().toLowerCase();
  return rule.categoryRates.find((c) => c.category === key)?.rate ?? rule.baseRate;
}

/** What `amount` paise earns at `rate`, rounded down. Integer maths. */
export function earnOn(kind: RewardKind, rate: number, amount: number): number {
  const hundredths = Math.round(rate * 100);
  const divisor = kind === "cashback" ? 10_000 : 1_000_000;
  return Math.floor((amount * hundredths) / divisor);
}

export function computeRewards(rule: RewardRule, txns: RewardTxn[]): RewardResult {
  const lines = new Map<string, { rate: number; spend: number; gross: number; reversed: number }>();
  let spend = 0;
  let refunded = 0;
  let gross = 0;
  let reversed = 0;

  for (const t of txns) {
    const isExpense = t.type === "expense";
    const isRefund = t.type === "income" && t.refundStatus === "confirmed";
    if (!isExpense && !isRefund) continue;
    const category = (t.category || "other").trim().toLowerCase();
    const rate = rateFor(rule, category);
    const line = lines.get(category) ?? { rate, spend: 0, gross: 0, reversed: 0 };
    const amount = earnOn(rule.kind, rate, t.amount);
    if (isExpense) {
      line.spend += t.amount;
      line.gross += amount;
      spend += t.amount;
      gross += amount;
    } else {
      line.spend -= t.amount;
      line.reversed += amount;
      refunded += t.amount;
      reversed += amount;
    }
    lines.set(category, line);
  }

  const uncapped = Math.max(0, gross - reversed);
  const capReached = rule.cap != null && uncapped > rule.cap;
  const earned = rule.cap != null ? Math.min(uncapped, rule.cap) : uncapped;
  const pointValue = rule.pointValue ?? DEFAULT_POINT_VALUE;

  return {
    unit: rule.kind === "cashback" ? "paise" : "points",
    spend,
    refunded,
    uncapped,
    earned,
    capReached,
    value: rule.kind === "cashback" ? earned : earned * pointValue,
    byCategory: [...lines.entries()]
      .map(([category, l]) => ({
        category,
        rate: l.rate,
        spend: Math.max(0, l.spend),
        earned: Math.max(0, l.gross - l.reversed),
      }))
      .sort((a, b) => b.earned - a.earned || a.category.localeCompare(b.category)),
  };
}
