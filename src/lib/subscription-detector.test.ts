import { describe, expect, it } from "vitest";
import { addDays, addMonths, addYears } from "date-fns";
import { detectSubscriptions, merchantKey, subscriptionId, type Charge } from "@/lib/subscription-detector";

const NOW = new Date("2026-10-24T10:00:00Z");

function series(description: string, amounts: number[], next: (d: Date, i: number) => Date, start: Date, account = "acc1"): Charge[] {
  return amounts.map((amount, i) => ({ date: next(start, i), amount, description, category: "entertainment", account }));
}

const monthly = (d: Date, i: number) => addMonths(d, i);
const weekly = (d: Date, i: number) => addDays(d, 7 * i);
const yearly = (d: Date, i: number) => addYears(d, i);

describe("merchantKey", () => {
  it("drops bank noise, digits and punctuation so one merchant gets one key", () => {
    expect(merchantKey("UPI-NETFLIX.COM-123456@ybl")).toBe("netflix com ybl");
    expect(merchantKey("Netflix")).toBe("netflix");
    expect(merchantKey("POS 4521 Spotify India Pvt Ltd")).toBe("spotify");
    expect(merchantKey("ref 99812")).toBe("");
    expect(merchantKey(undefined)).toBe("");
  });
});

describe("detectSubscriptions", () => {
  it("finds a monthly subscription with its next date and costs", () => {
    const found = detectSubscriptions(series("Netflix", [64900, 64900, 64900, 64900], monthly, new Date("2026-07-05")), NOW);
    expect(found).toHaveLength(1);
    const s = found[0];
    expect(s.cadence).toBe("monthly");
    expect(s.amount).toBe(64900);
    expect(s.occurrences).toBe(4);
    expect(s.lastDate).toEqual(new Date("2026-10-05"));
    expect(s.nextDate).toEqual(new Date("2026-11-05"));
    expect(s.monthlyCost).toBe(64900);
    expect(s.yearlyCost).toBe(64900 * 12);
    expect(s.active).toBe(true);
    expect(s.id).toBe(subscriptionId(s.key));
  });

  it("finds a weekly charge (4 weeks) and a yearly one (2 years)", () => {
    const w = detectSubscriptions(series("Milk Subscription", [12000, 12000, 12000, 12000, 12000], weekly, new Date("2026-09-20")), NOW);
    expect(w.map((s) => s.cadence)).toEqual(["weekly"]);
    expect(w[0].yearlyCost).toBe(12000 * 52);

    const y = detectSubscriptions(series("Domain Renewal", [99900, 99900], yearly, new Date("2024-12-01")), new Date("2026-10-24"));
    expect(y.map((s) => s.cadence)).toEqual(["yearly"]);
    expect(y[0].monthlyCost).toBe(Math.round(99900 / 12));
  });

  it("finds a quarterly charge", () => {
    const q = detectSubscriptions(series("Insurance Premium", [250000, 250000, 250000], (d, i) => addMonths(d, 3 * i), new Date("2026-01-10")), NOW);
    expect(q.map((s) => s.cadence)).toEqual(["quarterly"]);
    expect(q[0].yearlyCost).toBe(250000 * 4);
  });

  it("tolerates small amount noise and a price rise (typical amount is the median of the last three)", () => {
    const found = detectSubscriptions(series("Spotify", [11900, 11900, 11900, 13900, 13900], monthly, new Date("2026-06-03")), NOW);
    expect(found).toHaveLength(1);
    expect(found[0].amount).toBe(13900);
    expect(found[0].lastAmount).toBe(13900);
  });

  it("tolerates one skipped month in a longer history", () => {
    const dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05", "2026-07-05", "2026-09-05", "2026-10-05"].map((d) => new Date(d));
    const charges = dates.map((date) => ({ date, amount: 50000, description: "Gym", category: "health", account: "acc1" }));
    expect(detectSubscriptions(charges, NOW).map((s) => s.cadence)).toEqual(["monthly"]);
  });

  it("does not match one-offs, two-off monthly charges, or irregular spending", () => {
    const oneOff = series("Flight", [800000], monthly, new Date("2026-08-01"));
    const twoMonthly = series("Gadget Store", [50000, 50000], monthly, new Date("2026-08-01"));
    const irregular: Charge[] = ["2026-08-01", "2026-08-04", "2026-08-19", "2026-09-02", "2026-09-30", "2026-10-11"].map((d) => ({
      date: new Date(d), amount: 30000, description: "Cafe", category: "food", account: "acc1",
    }));
    expect(detectSubscriptions([...oneOff, ...twoMonthly, ...irregular], NOW)).toEqual([]);
  });

  it("does not match a steady gap with wildly different amounts", () => {
    const found = detectSubscriptions(series("Supermarket", [12000, 98000, 4500, 71000, 25000], monthly, new Date("2026-06-01")), NOW);
    expect(found).toEqual([]);
  });

  it("marks a subscription that stopped as not active", () => {
    const found = detectSubscriptions(series("Old Magazine", [20000, 20000, 20000], monthly, new Date("2026-01-10")), NOW);
    expect(found).toHaveLength(1);
    expect(found[0].active).toBe(false);
  });

  it("ignores charges without a description or with a non-positive amount", () => {
    const noName = series("", [10000, 10000, 10000], monthly, new Date("2026-08-01"));
    const zero = series("Free Trial", [0, 0, 0], monthly, new Date("2026-08-01"));
    expect(detectSubscriptions([...noName, ...zero], NOW)).toEqual([]);
  });

  it("groups one merchant spelled differently and sorts by yearly cost", () => {
    const a = series("UPI-NETFLIX-1111", [64900, 64900, 64900], monthly, new Date("2026-08-05"));
    const b = a.map((c) => ({ ...c, description: "UPI-NETFLIX-2222" }));
    const cheap = series("Cloud Backup", [9900, 9900, 9900], monthly, new Date("2026-08-07"));
    const found = detectSubscriptions([...a.slice(0, 1), ...b.slice(1), ...cheap], NOW);
    expect(found.map((s) => s.merchant === "Cloud Backup")).toEqual([false, true]);
    expect(found[0].occurrences).toBe(3);
  });
});
