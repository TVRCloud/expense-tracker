import { describe, expect, it } from "vitest";
import {
  dayNumber,
  fdValue,
  formatMicro,
  gainPercent,
  isDayKey,
  keyFromDayNumber,
  parseDecimal,
  simpleInterest,
  sipDueDates,
  valueFromPrice,
} from "@/lib/holding-math";

describe("parseDecimal and formatMicro", () => {
  it("reads a plain decimal at the given scale", () => {
    expect(parseDecimal("12.5", 6)).toBe(BigInt(12_500_000));
    expect(parseDecimal("0.000001", 6)).toBe(BigInt(1));
    expect(parseDecimal(" 7 ", 6)).toBe(BigInt(7_000_000));
  });
  it("refuses anything else", () => {
    for (const bad of ["", "-1", "1e3", "1,5", "1.", ".5", "abc", "1.1234567", "0x10", "1 000"]) {
      expect(parseDecimal(bad, 6), bad).toBeNull();
    }
  });
  it("round trips through the stored millionths", () => {
    expect(formatMicro(12_500_000)).toBe("12.5");
    expect(formatMicro(1)).toBe("0.000001");
    expect(formatMicro(3_000_000)).toBe("3");
    expect(formatMicro(0)).toBe("0");
  });
});

describe("valueFromPrice", () => {
  it("multiplies units by price exactly and rounds half up to the minor unit", () => {
    // 12.5 units at 123.4567 = 1543.208750 -> 154320.875 paise -> 154321
    expect(valueFromPrice(12_500_000, "123.4567")).toBe(154_321);
    // 3 units at 0.1 = 0.30 -> 30 paise: no 0.30000000000000004 drift
    expect(valueFromPrice(3_000_000, "0.1")).toBe(30);
    // 1 unit at 10.005 = 10.005 -> 1000.5 paise -> 1001 (half up)
    expect(valueFromPrice(1_000_000, "10.005")).toBe(1001);
    expect(valueFromPrice(1_000_000, "10.0049")).toBe(1000);
  });
  it("handles zero and refuses a bad price", () => {
    expect(valueFromPrice(0, "100")).toBe(0);
    expect(valueFromPrice(1_000_000, "0")).toBe(0);
    expect(valueFromPrice(1_000_000, "1.23456")).toBeNull();
    expect(valueFromPrice(1_000_000, "-1")).toBeNull();
    expect(valueFromPrice(1_000_000, "")).toBeNull();
  });
  it("returns null past what a double holds exactly", () => {
    expect(valueFromPrice(1_000_000_000_000_000, "999999999999")).toBeNull();
  });
});

describe("gainPercent", () => {
  it("is one decimal, half away from zero", () => {
    expect(gainPercent(10_000, 11_234)).toBe(12.3);
    expect(gainPercent(10_000, 11_235)).toBe(12.4);
    expect(gainPercent(10_000, 8_765)).toBe(-12.4);
    expect(gainPercent(10_000, 10_000)).toBe(0);
  });
  it("is null when nothing was invested", () => {
    expect(gainPercent(0, 5_000)).toBeNull();
  });
  it("stays exact for the largest amounts", () => {
    expect(gainPercent(1e13, 2e13)).toBe(100);
  });
});

describe("day keys", () => {
  it("accepts real calendar days only", () => {
    expect(isDayKey("2024-02-29")).toBe(true);
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-4-1")).toBe(false);
    expect(isDayKey("1800-01-01")).toBe(false);
  });
  it("counts whole days", () => {
    expect(dayNumber("2026-03-01") - dayNumber("2026-02-01")).toBe(28);
    expect(dayNumber("2024-03-01") - dayNumber("2024-02-01")).toBe(29);
    expect(keyFromDayNumber(dayNumber("2026-10-24"))).toBe("2026-10-24");
  });
});

describe("sipDueDates", () => {
  const sip = (dayOfMonth: number, startDay: string, active = true) => ({ dayOfMonth, startDay, active });

  it("lists the due dates in the window, today included", () => {
    expect(sipDueDates(sip(5, "2026-01-05"), "2026-10-05", 90)).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"]);
    expect(sipDueDates(sip(5, "2026-01-05"), "2026-10-06", 31)).toEqual(["2026-11-05"]);
    // the window is days 0 to N-1 from today: the 30th day after today is outside a 30-day window
    expect(sipDueDates(sip(5, "2026-01-05"), "2026-10-06", 30)).toEqual([]);
  });
  it("a SIP on the 31st falls on the last day of a short month and returns to the 31st", () => {
    expect(sipDueDates(sip(31, "2026-01-31"), "2026-01-31", 160, 6)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });
  it("handles leap day", () => {
    expect(sipDueDates(sip(29, "2024-01-29"), "2024-02-01", 60, 3)).toEqual(["2024-02-29", "2024-03-29"]);
    expect(sipDueDates(sip(29, "2026-01-29"), "2026-02-01", 60, 3)).toEqual(["2026-02-28", "2026-03-29"]);
  });
  it("skips dates before the start day and waits for a future start", () => {
    expect(sipDueDates(sip(5, "2026-10-15"), "2026-10-10", 60)).toEqual(["2026-11-05", "2026-12-05"]);
    expect(sipDueDates(sip(5, "2027-03-01"), "2026-10-10", 365, 2)).toEqual(["2027-03-05", "2027-04-05"]);
  });
  it("crosses a year end", () => {
    expect(sipDueDates(sip(15, "2025-01-15"), "2026-12-20", 30)).toEqual(["2027-01-15"]);
  });
  it("is empty for a paused SIP, a bad date or no window", () => {
    expect(sipDueDates(sip(5, "2026-01-05", false), "2026-10-05", 90)).toEqual([]);
    expect(sipDueDates(sip(5, "nope"), "2026-10-05", 90)).toEqual([]);
    expect(sipDueDates(sip(5, "2026-01-05"), "2026-10-05", 0)).toEqual([]);
  });
  it("is bounded and does not drift from a very old start", () => {
    const due = sipDueDates(sip(31, "1990-01-31"), "2026-03-01", 120, 12);
    expect(due).toEqual(["2026-03-31", "2026-04-30", "2026-05-31"]);
  });
});

describe("fixed deposit", () => {
  // 1,00,000 rupees = 10,000,000 paise at 7.25% for one 365-day year.
  const fd = { principal: 10_000_000, rateBps: 725, startDay: "2026-01-01", maturityDay: "2027-01-01" };

  it("simple interest is principal * rate * days / 365, rounded half up", () => {
    expect(simpleInterest(10_000_000, 725, 365)).toBe(725_000);
    expect(simpleInterest(10_000_000, 725, 0)).toBe(0);
    expect(simpleInterest(10_000_000, 0, 365)).toBe(0);
    // 1 paise principal never rounds up to interest from a tiny fraction; 5 paise at 10% for 1 day = 0.0014 -> 0
    expect(simpleInterest(5, 1000, 1)).toBe(0);
    // exact half: 365 * 5000 bps * 1 day / (10000 * 365) = 0.5 -> 1
    expect(simpleInterest(365, 5000, 1)).toBe(1);
  });
  it("accrues from the start day and stops at maturity", () => {
    expect(fdValue(fd, "2025-12-31")).toMatchObject({ accrued: 0, value: 10_000_000, matured: false });
    expect(fdValue(fd, "2026-01-01")).toMatchObject({ accrued: 0, daysToMaturity: 365 });
    const half = fdValue(fd, "2026-07-02"); // 182 days in
    expect(half.accrued).toBe(simpleInterest(10_000_000, 725, 182));
    expect(half.value).toBe(10_000_000 + half.accrued);
    expect(half.matured).toBe(false);
    const done = fdValue(fd, "2027-06-01");
    expect(done).toMatchObject({ accrued: 725_000, value: 10_725_000, maturityValue: 10_725_000, matured: true, daysToMaturity: 0 });
  });
  it("reports the whole term and the maturity value from any day", () => {
    expect(fdValue(fd, "2026-03-01")).toMatchObject({ termDays: 365, maturityValue: 10_725_000 });
  });
  it("a zero rate earns nothing", () => {
    expect(fdValue({ ...fd, rateBps: 0 }, "2027-01-01")).toMatchObject({ accrued: 0, value: 10_000_000, maturityValue: 10_000_000 });
  });
  it("counts a leap year as 366 actual days over 365", () => {
    const leap = { principal: 36_500, rateBps: 1000, startDay: "2024-01-01", maturityDay: "2025-01-01" };
    expect(fdValue(leap, "2025-01-01").maturityValue).toBe(36_500 + 3_660); // 366 days
  });
});
