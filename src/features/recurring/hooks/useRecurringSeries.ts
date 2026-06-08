"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { type ITransaction } from "@/types/models";

export interface RecurringSeries {
  _id: string;
  label?: string;
  description?: string;
  amount: number;
  frequency: string;
  interval: number;
  category: string;
  accountId: string;
  total: number;
  count: number;
  paidCount: number;
  remainingCount: number;
  nextDue?: string;
  startDate?: string;
}

interface SeriesDetail {
  data: ITransaction[];
  series: {
    recurringId: string;
    label?: string;
    description?: string;
    category: string;
    amount: number;
    frequency: string;
    interval: number;
    count: number;
    paidCount: number;
    remainingAmount: number;
    total: number;
    accountId: string;
  };
}

export function useRecurringSeriesList(accountId?: string) {
  return useQuery<{ data: RecurringSeries[] }>({
    queryKey: ["recurring-series", accountId],
    queryFn: async () => {
      const url = accountId
        ? `/transactions/recurring?accountId=${accountId}`
        : "/transactions/recurring";
      const res = await apiClient.get<{ data: RecurringSeries[] }>(url);
      return res.data;
    },
  });
}

export function useRecurringSeriesDetail(recurringId: string) {
  return useQuery<SeriesDetail>({
    queryKey: ["recurring-series-detail", recurringId],
    queryFn: async () => {
      const res = await apiClient.get<SeriesDetail>(`/transactions/recurring/${recurringId}`);
      return res.data;
    },
    enabled: !!recurringId,
  });
}

export function useUpcomingInstallments(limit = 5) {
  return useQuery<{ data: ITransaction[] }>({
    queryKey: ["upcoming-installments", limit],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ITransaction[] }>(`/transactions/recurring?upcoming=${limit}`);
      return res.data;
    },
  });
}

export function useMarkInstallment(recurringId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "paid" | "skipped" | "upcoming" | "overdue" }) =>
      apiClient.patch(`/transactions/recurring/${recurringId}/installments/${id}`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring-series-detail", recurringId] });
      void qc.invalidateQueries({ queryKey: ["recurring-series"] });
      void qc.invalidateQueries({ queryKey: ["upcoming-installments"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useCancelSeries(recurringId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete(`/transactions/recurring/${recurringId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring-series"] });
      void qc.invalidateQueries({ queryKey: ["upcoming-installments"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
