"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { toast } from "sonner";
import type { SpendLimitStatus, SpendLimitUpdate } from "@/features/budgets/schemas/spend-limit.schema";

// Under the ["budgets"] prefix on purpose: the budgets and transactions
// realtime resources already invalidate that prefix, so "left today" refreshes
// when an expense lands (src/lib/realtime/invalidation.ts).
export const SPEND_LIMIT_KEY = ["budgets", "spend-limit"] as const;

export function useSpendLimit() {
  return useQuery<SpendLimitStatus>({
    queryKey: SPEND_LIMIT_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{ data: SpendLimitStatus }>("/spend-limit");
      return res.data.data;
    },
  });
}

export function useUpdateSpendLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SpendLimitUpdate) => {
      const res = await apiClient.put<{ data: SpendLimitStatus }>("/spend-limit", input);
      return res.data.data;
    },
    onSuccess: (status) => {
      qc.setQueryData(SPEND_LIMIT_KEY, status);
      toast.success("Spend limit saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
