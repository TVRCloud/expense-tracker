"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";

export interface TaxRow {
  category: string;
  total: number;
}

export interface TaxMonth {
  month: string;
  income: number;
  expense: number;
  deductible: number;
}

export interface TaxSummary {
  fy: number;
  label: string;
  start: string;
  end: string;
  timeZone: string;
  income: number;
  expense: number;
  saved: number;
  count: number;
  deductible: { total: number; byCategory: TaxRow[] };
  incomeByCategory: TaxRow[];
  expenseByCategory: TaxRow[];
  byMonth: TaxMonth[];
  deductibleCategories: string[];
  availableYears: number[];
}

export function useTaxSummary(fy: number | undefined) {
  return useQuery<TaxSummary>({
    queryKey: ["tax", fy ?? "current"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: TaxSummary }>(`/tax${fy === undefined ? "" : `?fy=${fy}`}`);
      return res.data.data;
    },
  });
}

// Sends what moved (add or remove one name), not the whole list, so two quick
// switches or a second tab do not overwrite each other. Refetches either way,
// so a failed change shows the real list again.
export function useChangeDeductibleCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (diff: { add?: string[]; remove?: string[] }) => apiClient.patch("/tax/settings", diff),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tax"] }),
  });
}
