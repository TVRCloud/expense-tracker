import { describe, expect, it } from "vitest";
import {
  CATEGORY_JUMP,
  DUPLICATE_CHARGE,
  LARGE_SPEND,
  categoryJump,
  duplicateOf,
  largeSpend,
  median,
} from "@/lib/anomaly-rules";

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(3); // 2.5 rounds to 3
  });
});

describe("largeSpend", () => {
  const history = [20000, 25000, 30000, 30000, 35000, 40000]; // median 30000, threshold 90000, floor 100000
  it("needs at least 5 earlier expenses", () => {
    expect(largeSpend(5_000_000, [20000, 25000, 30000, 30000])).toBeNull();
    expect(largeSpend(5_000_000, [20000, 25000, 30000, 30000, 35000])).not.toBeNull();
  });
  it("fires at exactly the threshold and not one minor unit under it", () => {
    // threshold = max(3 x 30000, 100000) = 100000: the floor decides here
    expect(largeSpend(LARGE_SPEND.floor, history)).toEqual({ typical: 30000, threshold: 100000 });
    expect(largeSpend(LARGE_SPEND.floor - 1, history)).toBeNull();
  });
  it("uses the factor once the median is high enough to beat the floor", () => {
    const big = [50000, 50000, 50000, 50000, 50000]; // median 50000, 3x = 150000 > floor
    expect(largeSpend(150000, big)).toEqual({ typical: 50000, threshold: 150000 });
    expect(largeSpend(149999, big)).toBeNull();
  });
  it("never fires below the floor, however far above a tiny median", () => {
    expect(largeSpend(50000, [100, 100, 100, 100, 100, 100])).toBeNull();
  });
});

describe("duplicateOf", () => {
  const t0 = new Date("2026-10-10T10:00:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  const cur = { id: "b", amount: 49900, date: t0, description: "Cafe" };
  it("finds the same amount inside the window, nearest first", () => {
    const hit = duplicateOf(cur, [
      { id: "far", amount: 49900, date: at(-9), description: "Cafe" },
      { id: "near", amount: 49900, date: at(-2), description: "Cafe" },
    ]);
    expect(hit?.id).toBe("near");
  });
  it("is inclusive at the window edge and not beyond it", () => {
    expect(duplicateOf(cur, [{ id: "a", amount: 49900, date: at(-DUPLICATE_CHARGE.windowMinutes) }])).not.toBeNull();
    expect(duplicateOf(cur, [{ id: "a", amount: 49900, date: new Date(at(-DUPLICATE_CHARGE.windowMinutes).getTime() - 1) }])).toBeNull();
  });
  it("needs the same amount and ignores itself", () => {
    expect(duplicateOf(cur, [{ id: "a", amount: 49901, date: at(-1) }])).toBeNull();
    expect(duplicateOf(cur, [{ id: "b", amount: 49900, date: at(-1) }])).toBeNull();
  });
  it("different descriptions are different purchases; a missing one does not rule it out", () => {
    expect(duplicateOf(cur, [{ id: "a", amount: 49900, date: at(-1), description: "Taxi" }])).toBeNull();
    expect(duplicateOf(cur, [{ id: "a", amount: 49900, date: at(-1), description: " cafe " }])).not.toBeNull();
    expect(duplicateOf(cur, [{ id: "a", amount: 49900, date: at(-1) }])).not.toBeNull();
    expect(duplicateOf({ ...cur, description: undefined }, [{ id: "a", amount: 49900, date: at(-1), description: "Taxi" }])).not.toBeNull();
  });
  it("never fires under the floor", () => {
    const small = { id: "b", amount: DUPLICATE_CHARGE.floor - 1, date: t0 };
    expect(duplicateOf(small, [{ id: "a", amount: small.amount, date: at(-1) }])).toBeNull();
    const atFloor = { id: "b", amount: DUPLICATE_CHARGE.floor, date: t0 };
    expect(duplicateOf(atFloor, [{ id: "a", amount: atFloor.amount, date: at(-1) }])).not.toBeNull();
  });
});

describe("categoryJump", () => {
  const prev = (a: number, b: number, c: number) => [
    { monthsAgo: 1, total: a },
    { monthsAgo: 2, total: b },
    { monthsAgo: 3, total: c },
  ];
  it("fires at twice the baseline and the floor, and not one unit under", () => {
    // baseline = 100000, so month to date must be >= 200000 and exceed the baseline by >= 200000, that is 300000
    const rows = (mtd: number) => [{ monthsAgo: 0, total: mtd }, ...prev(100000, 100000, 100000)];
    expect(categoryJump(rows(300000), 15)).toEqual({ monthToDate: 300000, baseline: 100000 });
    expect(categoryJump(rows(299999), 15)).toBeNull();
  });
  it("the factor matters when the baseline is large", () => {
    const rows = (mtd: number) => [{ monthsAgo: 0, total: mtd }, ...prev(500000, 500000, 500000)];
    expect(categoryJump(rows(999999), 15)).toBeNull(); // under 2x, over the floor
    expect(categoryJump(rows(1_000_000), 15)).not.toBeNull();
  });
  it("needs spend in at least 2 of the 3 earlier months, and counts a quiet month as zero in the average", () => {
    const mtd = { monthsAgo: 0, total: 900000 };
    expect(categoryJump([mtd, ...prev(150000, 0, 0)], 15)).toBeNull();
    expect(categoryJump([mtd, ...prev(150000, 150000, 0)], 15)).toEqual({ monthToDate: 900000, baseline: 100000 });
  });
  it("waits for enough days of the month", () => {
    const rows = [{ monthsAgo: 0, total: 900000 }, ...prev(100000, 100000, 100000)];
    expect(categoryJump(rows, CATEGORY_JUMP.minElapsedDays - 1)).toBeNull();
    expect(categoryJump(rows, CATEGORY_JUMP.minElapsedDays)).not.toBeNull();
  });
  it("no history at all is not a jump", () => {
    expect(categoryJump([{ monthsAgo: 0, total: 900000 }], 20)).toBeNull();
  });
});
