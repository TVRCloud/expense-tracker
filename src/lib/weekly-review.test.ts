import { describe, expect, it, vi } from "vitest";

// The pure parts of the weekly review need no database. weekly-review.ts imports
// mongoose-backed modules, which load fine without a connection.
vi.mock("@/lib/redis", () => ({ redis: null }));

import { buildHighlights, dayStarts, summarizeWeek, type ReviewRow, type SpendLimitContext, type WeekSummary } from "@/lib/weekly-review";
import { dayWindow, localMidnight } from "@/lib/spend-limit-time";

const TZ = "Asia/Kolkata";
// Monday 19 Oct to Sunday 25 Oct 2026 on the Kolkata clock; "now" is Tuesday 10:00 after it.
const NOW = new Date("2026-10-27T04:30:00Z");
const weekStart = localMidnight(TZ, 2026, 10, 19);
const weekEnd = localMidnight(TZ, 2026, 10, 26);
const prevStart = localMidnight(TZ, 2026, 10, 12);
const at = (day: number, hour = 12) => new Date(`2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+05:30`);

let n = 0;
function row(over: Partial<ReviewRow>): ReviewRow {
  n += 1;
  return { _id: `r${n}`, type: "expense", amount: 10000, category: "Food", description: null, date: at(20), ...over };
}

const base = { weekStart, weekEnd, prevStart, timeZone: TZ, now: NOW, limit: null as SpendLimitContext | null };
const summarize = (rows: ReviewRow[], over: Partial<typeof base> = {}) => summarizeWeek(rows, { ...base, ...over });

describe("weeks on the user's clock", () => {
  it("runs Monday to Monday and has seven day starts plus the end", () => {
    const win = dayWindow(NOW, TZ, 1);
    expect(win.weekStart.toISOString()).toBe(localMidnight(TZ, 2026, 10, 26).toISOString());
    const starts = dayStarts(weekStart, TZ);
    expect(starts).toHaveLength(8);
    expect(starts[0].toISOString()).toBe(weekStart.toISOString());
    expect(starts[7].toISOString()).toBe(weekEnd.toISOString());
  });

  it("puts a transaction by the local day, not the UTC day", () => {
    const rows = [
      row({ date: new Date("2026-10-18T19:00:00Z"), amount: 500 }), // 00:30 Monday 19 Oct in Kolkata: this week
      row({ date: new Date("2026-10-25T20:00:00Z"), amount: 700 }), // 01:30 Monday 26 Oct in Kolkata: next week
      row({ date: new Date("2026-10-18T17:00:00Z"), amount: 900 }), // 22:30 Sunday 18 Oct in Kolkata: last week
    ];
    const s = summarize(rows);
    expect(s.totals.spent).toBe(500);
    expect(s.totals.previousSpent).toBe(900);
    expect(s.days[0]).toEqual({ date: "2026-10-19", spent: 500 });
  });
});

describe("summarizeWeek", () => {
  const rows = [
    row({ amount: 120000, category: "Food", description: "Swiggy", date: at(20) }),
    row({ amount: 30000, category: "Food", description: "swiggy ", date: at(22) }),
    row({ amount: 250000, category: "Shopping", description: "Amazon", date: at(21) }),
    row({ amount: 40000, category: "Transport", description: "Uber", date: at(23) }),
    row({ amount: 900000, type: "income", category: "Salary", description: "Acme", date: at(24) }),
    row({ amount: 500000, type: "transfer", category: "transfer", date: at(24) }),
    row({ amount: 99999, category: "Food", reviewStatus: "voided", date: at(24) }),
    // last week
    row({ amount: 300000, category: "Food", date: at(14) }),
    row({ amount: 100000, category: "Shopping", date: at(15) }),
  ];
  const s = summarize(rows);

  it("totals spending and income, leaving out transfers and voided rows", () => {
    expect(s.totals).toMatchObject({ spent: 440000, income: 900000, net: 460000, previousSpent: 400000 });
    expect(s.totals.change).toEqual({ amount: 40000, percent: 10 });
  });

  it("ranks categories with their share and merchants with a case-insensitive match", () => {
    expect(s.topCategories.map((c) => [c.category, c.total, c.share])).toEqual([
      ["Shopping", 250000, 57],
      ["Food", 150000, 34],
      ["Transport", 40000, 9],
    ]);
    expect(s.topMerchants[0]).toEqual({ merchant: "Amazon", total: 250000, count: 1 });
    expect(s.topMerchants[1]).toEqual({ merchant: "Swiggy", total: 150000, count: 2 });
  });

  it("finds the biggest expense and a spend per day", () => {
    expect(s.biggestExpense).toMatchObject({ amount: 250000, description: "Amazon", category: "Shopping" });
    expect(s.days.map((d) => d.spent)).toEqual([0, 120000, 250000, 30000, 40000, 0, 0]);
    expect(s.days[0].date).toBe("2026-10-19");
    expect(s.days[6].date).toBe("2026-10-25");
  });

  it("counts finished days with no spending", () => {
    expect(s.noSpendDays).toBe(3); // Mon, Sat and Sun
  });

  it("nets a confirmed refund out of spending and its category, not into income", () => {
    const r = summarize([
      row({ amount: 100000, category: "Shopping", date: at(20) }),
      row({ amount: 40000, type: "income", category: "Shopping", refundStatus: "confirmed", date: at(22) }),
    ]);
    expect(r.totals).toMatchObject({ spent: 60000, income: 0 });
    expect(r.topCategories[0]).toMatchObject({ category: "Shopping", total: 60000 });
  });

  it("dates a paid recurring installment by when it was paid", () => {
    const r = summarize([
      row({ amount: 200000, category: "Rent", recurringId: "series", installmentStatus: "paid", date: at(10), paidAt: at(21) }),
    ]);
    expect(r.totals.spent).toBe(200000);
    expect(r.days[2].spent).toBe(200000);
  });

  it("is quiet and zero for an empty week", () => {
    const e = summarize([]);
    expect(e.totals).toEqual({ spent: 0, income: 0, net: 0, previousSpent: 0, change: { amount: 0, percent: null } });
    expect(e.topCategories).toEqual([]);
    expect(e.biggestExpense).toBeNull();
    expect(e.noSpendDays).toBe(7);
    expect(e.spendLimit).toBeNull();
    expect(buildHighlights(e)).toEqual(["No spending recorded this week."]);
  });

  it("does not judge a week in progress before its days are over", () => {
    const wednesdayNoon = new Date("2026-10-21T06:30:00Z"); // 12:00 Wednesday in Kolkata
    const r = summarize([row({ date: at(20) })], { now: wednesdayNoon });
    expect(r.noSpendDays).toBe(1); // Monday and Tuesday are over; Tuesday had a spend. Wednesday is still going.
  });
});

describe("spend limit result", () => {
  const limit = (over: Partial<SpendLimitContext> = {}): SpendLimitContext => ({ dailyAmount: 100000, history: [], excludeCategories: [], ...over });

  it("counts the days within and over the daily limit, ignoring recurring bills and excluded categories", () => {
    const rows = [
      row({ amount: 150000, date: at(19) }), // over
      row({ amount: 90000, date: at(20) }), // within
      row({ amount: 500000, category: "Rent", recurringId: "s", installmentStatus: "paid", date: at(21), paidAt: at(21) }), // recurring: left out
      row({ amount: 400000, category: "Travel", date: at(22) }), // excluded category
    ];
    const s = summarize(rows, { limit: limit({ excludeCategories: ["Travel"] }) });
    expect(s.spendLimit).toEqual({ dailyAmount: 100000, daysWithin: 6, daysOver: 1, daysTracked: 7 });
  });

  it("judges each day by the limit in force that day", () => {
    const rows = [row({ amount: 80000, date: at(19) }), row({ amount: 80000, date: at(23) })];
    const history = [
      { from: new Date(0).toISOString(), dailyAmount: 70000, weeklyAmount: null },
      { from: localMidnight(TZ, 2026, 10, 22).toISOString(), dailyAmount: 100000, weeklyAmount: null },
    ];
    const s = summarize(rows, { limit: limit({ dailyAmount: 100000, history }) });
    // Monday 80000 was over the old 70000 limit, Friday 80000 is within the new 100000 one.
    expect(s.spendLimit).toMatchObject({ daysOver: 1, daysWithin: 6, daysTracked: 7 });
  });

  it("is null when no limit was ever set or no day was tracked", () => {
    expect(summarize([row({})], { limit: limit({ dailyAmount: null }) }).spendLimit).toBeNull();
    expect(summarize([row({})], { limit: null }).spendLimit).toBeNull();
    const sunday = new Date("2026-10-18T05:00:00Z");
    expect(summarize([], { limit: limit(), weekStart: weekStart, now: sunday }).spendLimit).toBeNull();
  });
});

describe("buildHighlights", () => {
  const empty = summarize([]);
  const make = (over: Partial<Omit<WeekSummary, "totals">> & { totals?: Partial<WeekSummary["totals"]> }): WeekSummary => ({
    ...empty,
    noSpendDays: 0,
    ...over,
    totals: { ...empty.totals, spent: 100000, ...over.totals },
  });

  it("says what changed on the week before once it moved by 10% or more", () => {
    expect(buildHighlights(make({ totals: { previousSpent: 130000, change: { amount: -30000, percent: -23 } } }))[0]).toBe(
      "You spent ₹300.00 less than the week before (down 23%)."
    );
    expect(buildHighlights(make({ totals: { previousSpent: 80000, change: { amount: 20000, percent: 25 } } }))[0]).toBe(
      "You spent ₹200.00 more than the week before (up 25%)."
    );
    expect(buildHighlights(make({ totals: { previousSpent: 98000, change: { amount: 2000, percent: 2 } } }))).toEqual([]);
  });

  it("reports the spend limit, no-spend days and the top category, two lines at most", () => {
    const h = buildHighlights(
      make({
        totals: { previousSpent: 200000, change: { amount: -100000, percent: -50 } },
        spendLimit: { dailyAmount: 100000, daysWithin: 5, daysOver: 2, daysTracked: 7 },
        noSpendDays: 3,
        topCategories: [{ category: "Food", total: 60000, share: 60 }],
      })
    );
    expect(h).toHaveLength(2);
    expect(h[1]).toBe("You went over your daily limit on 2 days.");
    expect(
      buildHighlights(make({ spendLimit: { dailyAmount: 100000, daysWithin: 7, daysOver: 0, daysTracked: 7 } }))
    ).toEqual(["You stayed within your daily limit every day."]);
    expect(buildHighlights(make({ noSpendDays: 2 }))).toEqual(["2 days with no spending."]);
    expect(buildHighlights(make({ topCategories: [{ category: "Food", total: 40000, share: 40 }] }))).toEqual([
      "Food was 40% of your spending.",
    ]);
  });
});
