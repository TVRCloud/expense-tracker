"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient, { isDefiniteRefusal } from "@/lib/api-client";
import { moveKeys } from "../lib/move-key";

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
  /** true only on a write's answer whose plan could not be read back: render nothing from it, the hooks refetch. */
  partial: boolean;
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

// The Idempotency-Key comes from the move itself (lib/move-key.ts), so every send of the same move is one
// request to the server. The mutation settles the key, not a per-call callback: it runs to the end even if the
// page is left, which per-call callbacks do not.
export function useMoveEnvelopeMoney() {
  return useEnvelopeMutation(async (body: { month: string; from: string; to: string; amount: number; allowOverdraw?: boolean }) => {
    const spec = { ...body, allowOverdraw: body.allowOverdraw === true };
    const key = moveKeys.keyFor(spec);
    try {
      const res = await apiClient.post("/envelopes/move", body, { headers: { "Idempotency-Key": key } });
      moveKeys.settle(spec);
      return res;
    } catch (err) {
      // Only a definite refusal settles it; a timeout, a dropped connection, a 5xx or a conflict may have moved the money.
      if (isDefiniteRefusal(err)) moveKeys.settle(spec);
      throw err;
    }
  });
}

export function useCopyEnvelopePlan() {
  return useEnvelopeMutation((body: { month: string; from?: string }) => apiClient.post("/envelopes/copy", body));
}

export function useSetEnvelopeMode() {
  return useEnvelopeMutation((enabled: boolean) => apiClient.put("/envelopes/settings", { enabled }));
}
