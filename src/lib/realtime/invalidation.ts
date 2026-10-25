import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeResource } from "@/lib/realtime/changes";

// Which TanStack query keys go stale when a resource changes. Keys are
// prefixes, so ["transactions"] also covers ["transactions", "stats", ...].
export const INVALIDATION_MAP: Readonly<Record<RealtimeResource, readonly (readonly string[])[]>> = {
  transactions: [
    ["transactions"],
    ["accounts"],
    ["credit-summary"],
    ["credit-statements"],
    ["upcoming-installments"],
    ["recurring-series"],
    ["recurring-series-detail"],
    ["budgets"],
    ["spend-limit"],
    ["analytics"],
    ["reconcile"],
    ["notifications"],
    ["subscriptions"],
    ["savings-rate"],
    ["net-worth"],
    ["tax"],
    ["envelopes"],
  ],
  accounts: [["accounts"], ["credit-summary"], ["credit-statements"], ["net-worth"]],
  budgets: [["budgets"], ["notifications"], ["envelopes"]],
  goals: [["goals"], ["notifications"]],
  loans: [["loans"], ["accounts"], ["notifications"], ["net-worth"]],
  notifications: [["notifications"]],
  captures: [["reconcile"], ["notifications"]],
  repayments: [["loans"], ["accounts"], ["notifications"], ["net-worth"]],
  statements: [["credit-statements"], ["credit-summary"], ["notifications"]],
  spendLimits: [["spend-limit"], ["budgets"]],
  subscriptions: [["subscriptions"]],
  sinkingFunds: [["sinking-funds"], ["notifications"]],
  netWorth: [["net-worth"]],
  aa: [["aa"], ["notifications"]],
  envelopes: [["envelopes"]],
  anomalies: [["anomalies"], ["notifications"]],
  holdings: [["holdings"], ["net-worth"]],
};

export function isRealtimeResource(value: unknown): value is RealtimeResource {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INVALIDATION_MAP, value);
}

export function queryKeysForResource(resource: RealtimeResource): readonly (readonly string[])[] {
  return INVALIDATION_MAP[resource];
}

/** Invalidate every query affected by `resource`. Also used by mutations so the acting tab is right too. */
export function invalidateForResource(qc: QueryClient, resource: RealtimeResource) {
  for (const queryKey of INVALIDATION_MAP[resource]) {
    void qc.invalidateQueries({ queryKey: [...queryKey] });
  }
}
