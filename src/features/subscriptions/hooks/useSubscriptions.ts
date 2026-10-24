"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { invalidateForResource } from "@/lib/realtime/invalidation";

export type SubscriptionStatus = "detected" | "confirmed" | "dismissed";
export type SubscriptionCadence = "weekly" | "monthly" | "quarterly" | "yearly";

export interface Subscription {
  id: string;
  merchant: string;
  category: string;
  accountId: string;
  cadence: SubscriptionCadence;
  amount: number;
  lastAmount: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  monthlyCost: number;
  yearlyCost: number;
  active: boolean;
  status: SubscriptionStatus;
}

export interface SubscriptionList {
  subscriptions: Subscription[];
  totals: { count: number; monthly: number; yearly: number };
}

export function useSubscriptions(status: "" | SubscriptionStatus = "") {
  return useQuery<SubscriptionList>({
    queryKey: ["subscriptions", status],
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await apiClient.get<{ data: SubscriptionList }>(`/subscriptions${qs}`);
      return res.data.data;
    },
  });
}

export function useSetSubscriptionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: SubscriptionStatus }) =>
      apiClient.patch(`/subscriptions/${id}`, { status }),
    onSuccess: () => invalidateForResource(qc, "subscriptions"),
  });
}
