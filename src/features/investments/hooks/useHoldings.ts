"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { invalidateForResource } from "@/lib/realtime/invalidation";

export type HoldingKind = "stock" | "mutual_fund" | "gold" | "fixed_deposit" | "ppf" | "other";

export const HOLDING_KIND_LABELS: Record<HoldingKind, string> = {
  stock: "Stocks",
  mutual_fund: "Mutual funds",
  gold: "Gold",
  fixed_deposit: "Fixed deposits",
  ppf: "PPF",
  other: "Other",
};

export interface Sip {
  amount: number;
  dayOfMonth: number;
  startDay: string;
  active: boolean;
  nextDue: string | null;
}

export interface FixedDeposit {
  principal: number;
  rateBps: number;
  startDay: string;
  maturityDay: string;
  accrued: number;
  maturityValue: number;
  termDays: number;
  daysToMaturity: number;
  matured: boolean;
}

export interface Holding {
  id: string;
  name: string;
  kind: HoldingKind;
  note: string | null;
  units: string | null;
  invested: number;
  value: number;
  gain: number;
  gainPercent: number | null;
  valueUpdatedAt: string | null;
  sip: Sip | null;
  fd: FixedDeposit | null;
}

export interface HoldingTotals {
  count: number;
  invested: number;
  value: number;
  gain: number;
  gainPercent: number | null;
}

export interface KindBreakdown {
  kind: HoldingKind;
  count: number;
  invested: number;
  value: number;
  gain: number;
}

export interface UpcomingSip {
  holdingId: string;
  name: string;
  amount: number;
  date: string;
}

export interface HoldingsData {
  holdings: Holding[];
  totals: HoldingTotals;
  byKind: KindBreakdown[];
  upcomingSips: UpcomingSip[];
}

export interface NewHolding {
  name: string;
  kind: HoldingKind;
  units?: string;
  investedAmount?: number;
  currentValue?: number;
  sip?: { amount: number; dayOfMonth: number; startDay: string; active: boolean };
  fd?: { principal: number; rateBps: number; startDay: string; maturityDay: string };
}

export function useHoldings() {
  return useQuery<HoldingsData>({
    queryKey: ["holdings"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: HoldingsData }>("/holdings");
      return res.data.data;
    },
  });
}

export function useAddHolding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewHolding) => apiClient.post("/holdings", input),
    onSuccess: () => invalidateForResource(qc, "holdings"),
  });
}

export function useSetHoldingValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; value?: number; price?: string }) => apiClient.post(`/holdings/${id}/value`, body),
    onSuccess: () => invalidateForResource(qc, "holdings"),
  });
}

export function useArchiveHolding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/holdings/${id}`),
    onSuccess: () => invalidateForResource(qc, "holdings"),
  });
}
