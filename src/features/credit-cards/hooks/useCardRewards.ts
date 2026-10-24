"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { type IRewardRule } from "@/types/models";

export interface CardRewardCycle {
  label: string;
  periodStart: string;
  periodEnd: string;
  isCurrent: boolean;
  unit: "paise" | "points";
  spend: number;
  refunded: number;
  earned: number;
  capReached: boolean;
  value: number; // cents
  byCategory: { category: string; rate: number; spend: number; earned: number }[];
}

export interface CardRewardsResponse {
  accountId: string;
  rule: Required<Pick<IRewardRule, "kind" | "baseRate">> &
    { categoryRates: { category: string; rate: number }[]; cap: number | null; pointValue: number | null } | null;
  reason: "no_rule" | "billing_cycle_not_set" | null;
  cycles: CardRewardCycle[];
  total: { earned: number; value: number } | null;
}

export function useCardRewards(accountId: string) {
  return useQuery<CardRewardsResponse>({
    queryKey: ["card-rewards", accountId],
    queryFn: async () => (await apiClient.get<CardRewardsResponse>(`/credit-cards/${accountId}/rewards?cycles=3`)).data,
    enabled: !!accountId,
  });
}

export function useSaveCardRewardRule(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: IRewardRule | null) =>
      rule ? apiClient.put(`/credit-cards/${accountId}/rewards`, rule) : apiClient.delete(`/credit-cards/${accountId}/rewards`),
    onSuccess: (_res, rule) => {
      void qc.invalidateQueries({ queryKey: ["card-rewards", accountId] });
      toast.success(rule ? "Reward rule saved" : "Reward rule removed");
    },
    onError: () => toast.error("Could not save the reward rule"),
  });
}
