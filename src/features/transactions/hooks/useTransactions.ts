"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { type ITransaction } from "@/types/models";
import { toast } from "sonner";
import { useSocket } from "@/hooks/useSocket";

export interface TransactionFilters {
  type?: string;
  category?: string;
  accountId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  hideFuture?: boolean;
  includeUnpaidRecurring?: boolean;
  skip?: number;
  limit?: number;
}

export function useTransactions(filters: TransactionFilters = {}) {
  const qc = useQueryClient();
  const onDataChanged = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["transactions"] });
  }, [qc]);
  useSocket("data:changed", onDataChanged);

  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.search) params.set("search", filters.search);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.hideFuture) params.set("hideFuture", "true");
  if (filters.includeUnpaidRecurring) params.set("includeUnpaidRecurring", "true");
  params.set("skip", String(filters.skip ?? 0));
  params.set("limit", String(filters.limit ?? 20));

  return useQuery<{ data: ITransaction[]; total: number }>({
    queryKey: ["transactions", filters],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ITransaction[]; total: number }>(
        `/transactions?${params}`
      );
      return res.data;
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/transactions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Transaction deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.post("/transactions", data).then((r) => r.data.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["credit-summary"] });
      void qc.invalidateQueries({ queryKey: ["credit-statements"] });
      toast.success("Transaction saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
