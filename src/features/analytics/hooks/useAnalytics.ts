"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { type TransactionStats } from "@/types/models";

export interface MonthHistory {
  year: number;
  month: number;
  stats: TransactionStats;
}

export function useMonthStats(month: number, year: number) {
  return useQuery<TransactionStats>({
    queryKey: ["transactions", "stats", month, year],
    queryFn: async () => {
      const res = await apiClient.get<{ data: TransactionStats }>(
        `/transactions/stats?month=${month}&year=${year}`
      );
      return res.data.data;
    },
  });
}

export function useMultiMonthStats(months: { month: number; year: number }[]) {
  return useQuery<MonthHistory[]>({
    queryKey: ["analytics", "multimonth", months.map((m) => `${m.year}-${m.month}`).join(",")],
    queryFn: async () => {
      const monthParam = months.map((m) => `${m.year}-${m.month}`).join(",");
      const res = await apiClient.get<{ data: MonthHistory[] }>(
        `/transactions/stats/range?months=${encodeURIComponent(monthParam)}`
      );
      return res.data.data;
    },
    staleTime: 60_000,
  });
}
