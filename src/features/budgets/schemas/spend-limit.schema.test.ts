import { describe, expect, it } from "vitest";
import {
  centsToInput,
  pausedUntilFor,
  rupeesToCents,
  spendLimitUpdateSchema,
} from "@/features/budgets/schemas/spend-limit.schema";

describe("rupeesToCents", () => {
  it("converts whole and decimal rupees", () => {
    expect(rupeesToCents("250")).toBe(25000);
    expect(rupeesToCents("250.5")).toBe(25050);
    expect(rupeesToCents(" 0.07 ")).toBe(7);
  });
  it("is null for blank and NaN for junk", () => {
    expect(rupeesToCents("")).toBeNull();
    expect(rupeesToCents("  ")).toBeNull();
    for (const bad of ["abc", "-5", "1.234", "1e3", "1,000"]) expect(rupeesToCents(bad)).toBeNaN();
  });
  it("does not drift on amounts like 19.99", () => {
    expect(rupeesToCents("19.99")).toBe(1999);
    expect(rupeesToCents("1.15")).toBe(115);
  });
});

describe("centsToInput", () => {
  it("round-trips with rupeesToCents", () => {
    for (const cents of [100, 25050, 7, 1999, 100000]) {
      expect(rupeesToCents(centsToInput(cents))).toBe(cents);
    }
  });
  it("is blank when there is no limit", () => {
    expect(centsToInput(null)).toBe("");
    expect(centsToInput(undefined)).toBe("");
  });
});

describe("pausedUntilFor", () => {
  const now = new Date("2026-10-23T10:00:00.000Z");
  it("leaves the pause alone, resumes, or pauses N days", () => {
    expect(pausedUntilFor("keep", now)).toBeUndefined();
    expect(pausedUntilFor("resume", now)).toBeNull();
    expect(pausedUntilFor("3", now)).toBe("2026-10-26T10:00:00.000Z");
    expect(pausedUntilFor("7", now)).toBe("2026-10-30T10:00:00.000Z");
  });
  it("produces a value the schema accepts", () => {
    expect(spendLimitUpdateSchema.safeParse({ pausedUntil: pausedUntilFor("1", now) }).success).toBe(true);
  });
});

describe("spendLimitUpdateSchema", () => {
  it("accepts what the dialog sends, including null to clear", () => {
    const ok = spendLimitUpdateSchema.safeParse({
      dailyAmount: 100000,
      weeklyAmount: null,
      alertAt: 80,
      excludeCategories: ["rent"],
      rollover: true,
      pausedUntil: null,
    });
    expect(ok.success).toBe(true);
  });
  it("rejects what the server rejects", () => {
    for (const bad of [
      { dailyAmount: 0 },
      { dailyAmount: -5 },
      { dailyAmount: 1.5 },
      { alertAt: 0 },
      { alertAt: 101 },
      { pausedUntil: "tomorrow" },
      { excludeCategories: [""] },
    ]) {
      expect(spendLimitUpdateSchema.safeParse(bad).success).toBe(false);
    }
  });
});
