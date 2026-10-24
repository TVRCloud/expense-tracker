import { describe, expect, it } from "vitest";
import { DEFAULT_POINT_VALUE, computeRewards, earnOn, normalizeRule, rewardRuleSchema, type RewardRule } from "@/lib/card-rewards";

const cashback = (over: Partial<RewardRule> = {}): RewardRule => ({
  kind: "cashback",
  baseRate: 1,
  categoryRates: [],
  cap: null,
  pointValue: null,
  ...over,
});
const points = (over: Partial<RewardRule> = {}): RewardRule => ({ ...cashback({ kind: "points", baseRate: 2 }), ...over });
const spend = (amount: number, category = "food") => ({ type: "expense", amount, category });

describe("earnOn", () => {
  it("rounds down on every transaction, in whole paise", () => {
    expect(earnOn("cashback", 1.5, 100_000)).toBe(1_500); // 1.5% of 1,000.00
    expect(earnOn("cashback", 1, 99)).toBe(0); // 99 paise at 1% is under one paise
    expect(earnOn("cashback", 1, 199)).toBe(1); // not 2
  });

  it("does not drift on rates that are not exact in binary", () => {
    expect(earnOn("cashback", 0.1, 1_000_000)).toBe(1_000);
    expect(earnOn("cashback", 0.3, 1_000_000)).toBe(3_000);
    expect(earnOn("cashback", 1.1, 1_000_000)).toBe(11_000);
  });

  it("points are per 100 rupees", () => {
    expect(earnOn("points", 2, 10_000)).toBe(2); // 2 points on 100.00
    expect(earnOn("points", 2, 19_999)).toBe(3); // 199.99 earns 3, not 4
    expect(earnOn("points", 0.5, 20_000)).toBe(1);
  });
});

describe("computeRewards", () => {
  it("uses the category rate when there is one, the base rate otherwise", () => {
    const r = computeRewards(cashback({ baseRate: 1, categoryRates: [{ category: "fuel", rate: 5 }] }), [
      spend(100_000, "Fuel"),
      spend(100_000, "food"),
    ]);
    expect(r.earned).toBe(5_000 + 1_000);
    expect(r.value).toBe(6_000);
    expect(r.unit).toBe("paise");
    expect(r.byCategory).toEqual([
      { category: "fuel", rate: 5, spend: 100_000, earned: 5_000 },
      { category: "food", rate: 1, spend: 100_000, earned: 1_000 },
    ]);
  });

  it("caps the cycle total, and says when the cap was reached", () => {
    const rule = cashback({ baseRate: 5, cap: 3_000 });
    const under = computeRewards(rule, [spend(40_000)]);
    expect(under).toMatchObject({ uncapped: 2_000, earned: 2_000, capReached: false });
    const over = computeRewards(rule, [spend(40_000), spend(40_000)]);
    expect(over).toMatchObject({ uncapped: 4_000, earned: 3_000, capReached: true, value: 3_000 });
  });

  it("a confirmed refund takes back exactly what the purchase earned", () => {
    const rule = cashback({ baseRate: 1.5 });
    const full = computeRewards(rule, [spend(12_345), { type: "income", amount: 12_345, category: "food", refundStatus: "confirmed" }]);
    expect(full).toMatchObject({ spend: 12_345, refunded: 12_345, uncapped: 0, earned: 0 });
    const partial = computeRewards(rule, [spend(100_000), { type: "income", amount: 40_000, category: "food", refundStatus: "confirmed" }]);
    expect(partial.earned).toBe(1_500 - 600);
  });

  it("ignores transfers, card payments and income that is not a confirmed refund", () => {
    const r = computeRewards(cashback({ baseRate: 10 }), [
      { type: "transfer", amount: 500_000, category: "transfer" },
      { type: "income", amount: 500_000, category: "payment" },
      { type: "income", amount: 500_000, category: "food", refundStatus: "suggested" },
      spend(10_000),
    ]);
    expect(r).toMatchObject({ spend: 10_000, refunded: 0, earned: 1_000 });
  });

  it("never goes negative when a refund outweighs the cycle's purchases", () => {
    const r = computeRewards(cashback({ baseRate: 2 }), [{ type: "income", amount: 50_000, category: "food", refundStatus: "confirmed" }]);
    expect(r).toMatchObject({ earned: 0, uncapped: 0 });
    expect(r.byCategory[0]).toMatchObject({ category: "food", earned: 0, spend: 0 });
  });

  it("points: counts points and values them, with a default point value", () => {
    const r = computeRewards(points({ baseRate: 4 }), [spend(250_000)]);
    expect(r).toMatchObject({ unit: "points", earned: 100, value: 100 * DEFAULT_POINT_VALUE });
    const custom = computeRewards(points({ baseRate: 4, pointValue: 50 }), [spend(250_000)]);
    expect(custom.value).toBe(5_000);
  });

  it("no transactions, no rewards", () => {
    expect(computeRewards(cashback(), [])).toMatchObject({ spend: 0, earned: 0, value: 0, capReached: false, byCategory: [] });
  });
});

describe("rewardRuleSchema", () => {
  const ok = { kind: "cashback", baseRate: 1.5, categoryRates: [{ category: " Fuel ", rate: 5 }], cap: 100000 };

  it("accepts a rule and lowercases category names", () => {
    const parsed = rewardRuleSchema.parse(ok);
    expect(parsed.categoryRates).toEqual([{ category: "fuel", rate: 5 }]);
  });

  it.each([
    ["more than 100 percent cashback", { ...ok, baseRate: 101 }],
    ["more than 1000 points per 100 rupees", { kind: "points", baseRate: 1001 }],
    ["a negative rate", { ...ok, baseRate: -1 }],
    ["three decimals", { ...ok, baseRate: 1.234 }],
    ["a category listed twice", { ...ok, categoryRates: [{ category: "fuel", rate: 1 }, { category: "FUEL", rate: 2 }] }],
    ["a point value on cashback", { ...ok, pointValue: 25 }],
    ["a zero cap", { ...ok, cap: 0 }],
    ["a fractional cap", { ...ok, cap: 10.5 }],
    ["an unknown kind", { ...ok, kind: "miles" }],
    ["an unknown field", { ...ok, extra: true }],
    ["31 category rates", { ...ok, categoryRates: Array.from({ length: 31 }, (_, i) => ({ category: `c${i}`, rate: 1 })) }],
  ])("rejects %s", (_name, body) => {
    expect(rewardRuleSchema.safeParse(body).success).toBe(false);
  });

  it("allows a null cap and a point value on points", () => {
    expect(rewardRuleSchema.safeParse({ kind: "cashback", baseRate: 1, cap: null }).success).toBe(true);
    expect(rewardRuleSchema.safeParse({ kind: "points", baseRate: 2, pointValue: 40 }).success).toBe(true);
  });
});

describe("normalizeRule", () => {
  it("returns null for nothing or a broken document", () => {
    expect(normalizeRule(undefined)).toBeNull();
    expect(normalizeRule({})).toBeNull();
    expect(normalizeRule({ kind: "miles" })).toBeNull();
  });

  it("fills the optional parts", () => {
    expect(normalizeRule({ kind: "cashback", baseRate: 2 })).toEqual({
      kind: "cashback",
      baseRate: 2,
      categoryRates: [],
      cap: null,
      pointValue: null,
    });
  });
});
