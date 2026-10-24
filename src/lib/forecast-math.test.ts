import { describe, expect, it } from "vitest";
import { buildForecast, clampDays, localDateKey, subscriptionOccurrences, type ForecastEvent } from "@/lib/forecast-math";

const DAY = 86_400_000;
// 10:00 on 24 Oct 2026 in Kolkata.
const now = new Date("2026-10-24T04:30:00Z");
const KOLKATA = "Asia/Kolkata";
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY);
const ev = (offset: number, amount: number, label = "x", kind: ForecastEvent["kind"] = "recurring"): ForecastEvent => ({
  date: at(offset),
  amount,
  label,
  kind,
});

describe("clampDays", () => {
  it("defaults to 30 and keeps 1 to 60", () => {
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays(null)).toBe(30);
    expect(clampDays(Number.NaN)).toBe(30);
    expect(clampDays(0)).toBe(1);
    expect(clampDays(-5)).toBe(1);
    expect(clampDays(45.9)).toBe(45);
    expect(clampDays(500)).toBe(60);
  });
});

describe("localDateKey", () => {
  it("is the calendar day on the user's wall clock", () => {
    const instant = new Date("2026-10-24T20:00:00Z");
    expect(localDateKey(instant, KOLKATA)).toBe("2026-10-25");
    expect(localDateKey(instant, "America/New_York")).toBe("2026-10-24");
    expect(localDateKey(instant, "Not/AZone")).toBe("2026-10-25"); // falls back to Asia/Kolkata
  });
});

describe("buildForecast", () => {
  it("with nothing known, spends the daily average from tomorrow on", () => {
    const f = buildForecast({ startingBalance: 100_000, now, days: 5, timeZone: KOLKATA, events: [], dailySpend: 1_000 });
    expect(f.points.map((p) => p.date)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(f.points.map((p) => p.balance)).toEqual([100_000, 99_000, 98_000, 97_000, 96_000]);
    expect(f.points[0].change).toBe(0); // today's spending is already in the balance
    expect(f.endBalance).toBe(96_000);
    expect(f.lowest).toEqual({ date: "2026-10-28", balance: 96_000 });
    expect(f.goesNegative).toBe(false);
    expect(f.firstNegativeDate).toBeNull();
    expect(f.totals).toEqual({ inflows: 0, outflows: 0, dailySpendTotal: 4_000 });
    expect(f.events).toEqual([]);
  });

  it("lands salary on its day and lifts the balance from then on", () => {
    const f = buildForecast({
      startingBalance: 50_000,
      now,
      days: 10,
      timeZone: KOLKATA,
      events: [ev(7, 5_000_000, "Salary")],
      dailySpend: 0,
    });
    expect(f.points[6].balance).toBe(50_000);
    expect(f.points[7].balance).toBe(5_050_000);
    expect(f.endBalance).toBe(5_050_000);
    expect(f.lowest.balance).toBe(50_000);
    expect(f.lowest.date).toBe("2026-10-24"); // the first of the equal lowest days
    expect(f.events).toEqual([{ date: "2026-10-31", kind: "recurring", label: "Salary", amount: 5_000_000 }]);
    expect(f.totals.inflows).toBe(5_000_000);
  });

  it("shows a card due before payday as a dip below zero, with the day it starts", () => {
    const f = buildForecast({
      startingBalance: 100_000,
      now,
      days: 14,
      timeZone: KOLKATA,
      events: [ev(3, -300_000, "Axis payment", "card"), ev(10, 500_000, "Salary")],
      dailySpend: 10_000,
    });
    expect(f.goesNegative).toBe(true);
    expect(f.firstNegativeDate).toBe("2026-10-27");
    // 100000 - 3 days x 10000 - 300000 on day 3
    expect(f.points[3].balance).toBe(-230_000);
    // the daily spend keeps running until payday: day 9 is the lowest, -230000 - 6 x 10000
    expect(f.lowest).toEqual({ date: "2026-11-02", balance: -290_000 });
    expect(f.points[10].balance).toBe(200_000); // -290000 - 10000 + 500000 on payday
  });

  it("counts an overdue item today and leaves out items after the window", () => {
    const f = buildForecast({
      startingBalance: 1_000_000,
      now,
      days: 7,
      timeZone: KOLKATA,
      events: [ev(-3, -200_000, "Gym"), ev(7, -999_999, "Too far"), ev(6, -100_000, "Last day")],
      dailySpend: 0,
    });
    expect(f.points[0].balance).toBe(800_000);
    expect(f.points[6].balance).toBe(700_000);
    expect(f.events.map((e) => [e.date, e.label])).toEqual([
      ["2026-10-24", "Gym"],
      ["2026-10-30", "Last day"],
    ]);
  });

  it("puts events on the user's calendar day, not the server's", () => {
    const instant = new Date("2026-10-24T20:00:00Z"); // 01:30 on the 25th in Kolkata, 16:00 on the 24th in New York
    const base = { startingBalance: 0, now: instant, days: 3, events: [{ date: instant, amount: 100, label: "x", kind: "recurring" as const }], dailySpend: 0 };
    const kolkata = buildForecast({ ...base, timeZone: KOLKATA });
    const newYork = buildForecast({ ...base, timeZone: "America/New_York" });
    expect(kolkata.points[0].date).toBe("2026-10-25");
    expect(newYork.points[0].date).toBe("2026-10-24");
    expect(kolkata.points[0].balance).toBe(100); // the event is today in both zones
    expect(newYork.points[0].balance).toBe(100);
  });

  it("orders events by day, then the bigger outflow first", () => {
    const f = buildForecast({
      startingBalance: 0,
      now,
      days: 5,
      timeZone: KOLKATA,
      events: [ev(2, 300, "b"), ev(1, -50, "z"), ev(2, -700, "a"), ev(1, -50, "y")],
      dailySpend: 0,
    });
    expect(f.events.map((e) => e.label)).toEqual(["y", "z", "a", "b"]);
  });

  it("clamps days and ignores a negative daily spend", () => {
    const f = buildForecast({ startingBalance: 10, now, days: 500, timeZone: KOLKATA, events: [], dailySpend: -50 });
    expect(f.days).toBe(60);
    expect(f.points).toHaveLength(60);
    expect(f.endBalance).toBe(10);
  });
});

describe("subscriptionOccurrences", () => {
  it("lists one monthly charge inside 30 days and none beyond", () => {
    expect(subscriptionOccurrences(at(5), "monthly", now, 30, KOLKATA)).toHaveLength(1);
    expect(subscriptionOccurrences(at(31), "monthly", now, 30, KOLKATA)).toHaveLength(0);
  });

  it("repeats weekly charges across the window", () => {
    const dates = subscriptionOccurrences(at(2), "weekly", now, 30, KOLKATA);
    expect(dates).toHaveLength(4); // days 2, 9, 16, 23
  });

  it("catches a long-overdue weekly charge up to today instead of emitting past-dated ones", () => {
    // Ten years behind (3650 mod 7 = 3): the overdue charge counts once today, then the cadence resumes on 28 Oct.
    const dates = subscriptionOccurrences(at(-3650), "weekly", now, 30, KOLKATA);
    expect(dates.map((d) => localDateKey(d, KOLKATA))).toEqual(["2026-10-24", "2026-10-28", "2026-11-04", "2026-11-11", "2026-11-18"]);
  });

  it("counts a charge dated today once, and respects the window edges", () => {
    expect(subscriptionOccurrences(at(0), "monthly", now, 30, KOLKATA).map((d) => localDateKey(d, KOLKATA))).toEqual(["2026-10-24"]);
    expect(subscriptionOccurrences(at(29), "monthly", now, 30, KOLKATA)).toHaveLength(1); // last day inside the window
    expect(subscriptionOccurrences(at(30), "monthly", now, 30, KOLKATA)).toHaveLength(0); // first day outside it
    expect(subscriptionOccurrences(at(0), "monthly", now, 1, KOLKATA)).toHaveLength(1);
    expect(subscriptionOccurrences(at(1), "monthly", now, 1, KOLKATA)).toHaveLength(0);
  });

  it("treats an unknown cadence as monthly", () => {
    const dates = subscriptionOccurrences(at(2), "fortnightly", now, 40, KOLKATA);
    expect(dates.map((d) => localDateKey(d, KOLKATA))).toEqual(["2026-10-26", "2026-11-26"]);
  });

  it("counts a charge exactly one cadence step overdue once today, not twice", () => {
    for (const [cadence, back] of [["weekly", -7], ["monthly", -30], ["quarterly", -92], ["yearly", -365]] as const) {
      const dates = subscriptionOccurrences(at(back), cadence, now, 30, KOLKATA);
      const today = dates.filter((d) => localDateKey(d, KOLKATA) === "2026-10-24");
      expect(today, cadence).toHaveLength(1);
    }
  });

  it("keeps a month-end charge on the 31st after a short month", () => {
    const anchor = new Date("2026-01-31T04:30:00.000Z"); // 10:00 in Kolkata
    const longAfter = new Date("2026-03-25T04:30:00.000Z");
    const dates = subscriptionOccurrences(anchor, "monthly", longAfter, 10, KOLKATA);
    expect(dates.map((d) => localDateKey(d, KOLKATA))).toEqual(["2026-03-25", "2026-03-31"]);
  });

  it("returns nothing for an invalid date", () => {
    expect(subscriptionOccurrences(new Date("nope"), "monthly", now, 30, KOLKATA)).toEqual([]);
  });

  it("counts an overdue charge today, then continues on the cadence", () => {
    const dates = subscriptionOccurrences(at(-2), "monthly", now, 40, KOLKATA);
    expect(dates).toHaveLength(2);
    expect(localDateKey(dates[0], KOLKATA)).toBe("2026-10-24");
    expect(localDateKey(dates[1], KOLKATA)).toBe("2026-11-22");
  });

  it("handles yearly and quarterly cadences", () => {
    expect(subscriptionOccurrences(at(100), "yearly", now, 60, KOLKATA)).toHaveLength(0);
    expect(subscriptionOccurrences(at(20), "quarterly", now, 60, KOLKATA)).toHaveLength(1);
  });
});
