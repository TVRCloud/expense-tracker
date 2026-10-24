"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { invalidateForResource } from "@/lib/realtime/invalidation";

export type NetWorthRange = "30d" | "90d" | "1y" | "all";
export type ManualAssetKind = "property" | "vehicle" | "gold" | "investment" | "other";

export interface BreakdownRow {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface NetWorthReport {
  assets: number;
  liabilities: number;
  netWorth: number;
  breakdown: { assets: BreakdownRow[]; liabilities: BreakdownRow[] };
  range: NetWorthRange;
  history: NetWorthPoint[];
  change: { amount: number; percent: number | null; since: string | null };
}

export interface ManualAsset {
  id: string;
  name: string;
  kind: ManualAssetKind;
  value: number;
  note: string | null;
}

export function useNetWorth(range: NetWorthRange) {
  return useQuery<NetWorthReport>({
    queryKey: ["net-worth", range],
    queryFn: async () => {
      const res = await apiClient.get<{ data: NetWorthReport }>(`/net-worth?range=${range}`);
      return res.data.data;
    },
  });
}

export function useManualAssets() {
  return useQuery<ManualAsset[]>({
    queryKey: ["net-worth", "assets"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ManualAsset[] }>("/net-worth/assets");
      return res.data.data;
    },
  });
}

export function useAddManualAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; kind: ManualAssetKind; value: number }) =>
      apiClient.post("/net-worth/assets", input),
    onSuccess: () => invalidateForResource(qc, "netWorth"),
  });
}

export function useRemoveManualAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/net-worth/assets/${id}`),
    onSuccess: () => invalidateForResource(qc, "netWorth"),
  });
}
