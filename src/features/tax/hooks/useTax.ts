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

export function useSetDeductibleCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deductibleCategories: string[]) => apiClient.put("/tax/settings", { deductibleCategories }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tax"] }),
  });
}
