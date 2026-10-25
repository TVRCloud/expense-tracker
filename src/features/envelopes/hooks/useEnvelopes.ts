"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";

export interface EnvelopeRow {
  category: string;
  assigned: number;
  spent: number;
  left: number;
  overspent: boolean;
}

export interface EnvelopePlan {
  enabled: boolean;
  month: string;
  currency: string;
  exponent: number;
  income: number;
  assigned: number;
  unassigned: number;
  overAssigned: boolean;
  envelopes: EnvelopeRow[];
  suggested: { category: string; limitAmount: number }[];
  moves: { from: string; to: string; amount: number; at: string }[];
  previousMonth: string;
  hasPrevious: boolean;
}

export function useEnvelopePlan(month: string | undefined) {
  return useQuery<EnvelopePlan>({
    queryKey: ["envelopes", month ?? "current"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: EnvelopePlan }>(`/envelopes${month ? `?month=${month}` : ""}`);
      return res.data.data;
    },
  });
}

// Every write refetches on settle, so a refused change shows the real plan again.
function useEnvelopeMutation<T>(fn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ["envelopes"] }) });
}

export function useAssignEnvelopes() {
  return useEnvelopeMutation((body: { month: string; income?: number; assign?: { category: string; assigned: number }[]; remove?: string[] }) =>
    apiClient.put("/envelopes", body)
  );
}

// `key` identifies one attempt: a double submit or a retry of the same attempt moves money once.
export function useMoveEnvelopeMoney() {
  return useEnvelopeMutation((body: { month: string; from: string; to: string; amount: number; allowOverdraw?: boolean; key: string }) => {
    const { key, ...rest } = body;
    return apiClient.post("/envelopes/move", rest, { headers: { "Idempotency-Key": key } });
  });
}

export function useCopyEnvelopePlan() {
  return useEnvelopeMutation((body: { month: string; from?: string }) => apiClient.post("/envelopes/copy", body));
}

export function useSetEnvelopeMode() {
  return useEnvelopeMutation((enabled: boolean) => apiClient.put("/envelopes/settings", { enabled }));
}
