import { describe, expect, it } from "vitest";
import { currentFy, fyBounds, fyLabel, fyMonthKeys, parseFy } from "@/lib/tax-year";

describe("financial year", () => {
  it("names the year by the April it starts in", () => {
    expect(fyLabel(2025)).toBe("2025-26");
    expect(fyLabel(2099)).toBe("2099-00");
  });

  it("starts at the user's midnight on 1 April, not UTC's", () => {
    const { start, end } = fyBounds(2025, "Asia/Kolkata");
    expect(start.toISOString()).toBe("2025-03-31T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-03-31T18:30:00.000Z");
  });

  it("puts 31 March and 1 April on either side, on the wall clock", () => {
    // 23:59 IST on 31 March 2026 is still 2025-26; 00:01 IST on 1 April is 2026-27.
    expect(currentFy(new Date("2026-03-31T18:29:00Z"), "Asia/Kolkata")).toBe(2025);
    expect(currentFy(new Date("2026-03-31T18:31:00Z"), "Asia/Kolkata")).toBe(2026);
    expect(currentFy(new Date("2026-01-15T00:00:00Z"), "Asia/Kolkata")).toBe(2025);
  });

  it("falls back to the default zone for a bad one", () => {
    expect(fyBounds(2025, "Not/AZone").start.toISOString()).toBe("2025-03-31T18:30:00.000Z");
  });

  it("lists April to March", () => {
    const keys = fyMonthKeys(2025);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2025-04");
    expect(keys[8]).toBe("2025-12");
    expect(keys[9]).toBe("2026-01");
    expect(keys[11]).toBe("2026-03");
  });

  it("accepts only a four digit year in range", () => {
    expect(parseFy("2025")).toBe(2025);
    for (const bad of ["25", "2025.5", "-2025", "abcd", "1999", "2101", "", "20255", "2025 "]) {
      expect(parseFy(bad)).toBeNull();
    }
  });
});
