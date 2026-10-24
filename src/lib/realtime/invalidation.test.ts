import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { INVALIDATION_MAP, invalidateForResource, isRealtimeResource } from "@/lib/realtime/invalidation";
import { RESOURCE_NAMES } from "@/lib/realtime/changes";

describe("INVALIDATION_MAP", () => {
  it("has an entry for every resource", () => {
    expect(Object.keys(INVALIDATION_MAP).sort()).toEqual([...RESOURCE_NAMES].sort());
  });
  it("transactions fan out to dependent screens", () => {
    const keys = INVALIDATION_MAP.transactions.map((k) => k[0]);
    expect(keys).toEqual(expect.arrayContaining(["accounts", "budgets", "analytics", "reconcile", "notifications", "upcoming-installments"]));
  });
  it("repayments and statements refresh loans and cards", () => {
    expect(INVALIDATION_MAP.repayments.map((k) => k[0])).toEqual(expect.arrayContaining(["loans", "accounts"]));
    expect(INVALIDATION_MAP.statements.map((k) => k[0])).toEqual(expect.arrayContaining(["credit-statements", "credit-summary"]));
  });
  it("spend limit changes refresh the limit card, and expenses do too", () => {
    expect(INVALIDATION_MAP.spendLimits.map((k) => k[0])).toEqual(["spend-limit", "budgets"]);
    expect(INVALIDATION_MAP.transactions.map((k) => k[0])).toContain("spend-limit");
  });
  it("sinking funds refresh their list, and spending refreshes the savings rate", () => {
    expect(INVALIDATION_MAP.sinkingFunds).toEqual([["sinking-funds"], ["notifications"]]);
    expect(INVALIDATION_MAP.transactions.map((k) => k[0])).toContain("savings-rate");
  });
  it("net worth refreshes when money, accounts or loans move, and when a manual asset changes", () => {
    expect(INVALIDATION_MAP.netWorth).toEqual([["net-worth"]]);
    for (const r of ["transactions", "accounts", "loans", "repayments"] as const) {
      expect(INVALIDATION_MAP[r].map((k) => k[0])).toContain("net-worth");
    }
  });
  it("spending refreshes the tax summary", () => {
    expect(INVALIDATION_MAP.transactions.map((k) => k[0])).toContain("tax");
  });
  it("captures touch reconcile and notifications", () => {
    expect(INVALIDATION_MAP.captures).toEqual([["reconcile"], ["notifications"]]);
  });
});

describe("invalidateForResource", () => {
  it("invalidates each mapped key", () => {
    const invalidateQueries = vi.fn();
    invalidateForResource({ invalidateQueries } as unknown as QueryClient, "goals");
    expect(invalidateQueries.mock.calls.map((c) => c[0].queryKey)).toEqual([["goals"], ["notifications"]]);
  });
});

describe("isRealtimeResource", () => {
  it("guards unknown payloads", () => {
    expect(isRealtimeResource("loans")).toBe(true);
    expect(isRealtimeResource(null)).toBe(false);
    expect(isRealtimeResource("constructor")).toBe(false);
  });
});
