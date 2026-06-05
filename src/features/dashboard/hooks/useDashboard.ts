"use client";

import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { type ITransaction, type IAccount, type TransactionStats } from "@/types/models";

function getCurrentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function useDashboardStats() {
  const { month, year } = getCurrentMonthYear();
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

export function useRecentTransactions(limit = 6) {
  return useQuery<ITransaction[]>({
    queryKey: ["transactions", "recent", limit],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ITransaction[] }>(
        `/transactions?limit=${limit}&skip=0`
      );
      return res.data.data;
    },
  });
}

export function useAccounts() {
  return useQuery<IAccount[]>({
    queryKey: ["accounts"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: IAccount[] }>("/accounts");
      return res.data.data;
    },
  });
}
