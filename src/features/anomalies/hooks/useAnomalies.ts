"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { invalidateForResource } from "@/lib/realtime/invalidation";

export type AnomalyKind = "large_spend" | "duplicate_charge" | "category_jump";
export type AnomalyStatus = "open" | "dismissed" | "confirmed_mine" | "reported";
export type AnomalyAction = "this_was_me" | "report" | "dismiss";

export interface Anomaly {
  id: string;
  kind: AnomalyKind;
  status: AnomalyStatus;
  category: string;
  amount: number;
  currency: string;
  transactionId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AnomalyList {
  data: Anomaly[];
  total: number;
  openCount: number;
  skip: number;
  limit: number;
}

export interface AnomalySettings {
  enabled: boolean;
  mutedCategories: string[];
}

export function useAnomalies(status: "open" | "all") {
  return useQuery<AnomalyList>({
    queryKey: ["anomalies", status],
    queryFn: async () => {
      const res = await apiClient.get<{ data: AnomalyList }>(`/anomalies?status=${status}&limit=50`);
      return res.data.data;
    },
  });
}

export function useAnomalySettings() {
  return useQuery<AnomalySettings>({
    queryKey: ["anomalies", "settings"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: AnomalySettings }>("/anomalies/settings");
      return res.data.data;
    },
  });
}

export function useAnswerAnomaly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: AnomalyAction }) => apiClient.patch(`/anomalies/${id}`, { status }),
    onSettled: () => invalidateForResource(qc, "anomalies"),
  });
}

// Sends what moved (switch, mute or unmute one name), not the whole list, so two quick
// changes or a second tab do not overwrite each other. Refetches either way.
export function useChangeAnomalySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (diff: { enabled?: boolean; add?: string[]; remove?: string[] }) => apiClient.patch("/anomalies/settings", diff),
    onSettled: () => qc.invalidateQueries({ queryKey: ["anomalies"] }),
  });
}
