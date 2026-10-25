"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";

export type ShareRole = "viewer" | "editor";

export interface OwnedShare {
  id: string;
  status: "pending" | "active" | "expired";
  role: ShareRole;
  includeBudgets: boolean;
  accountIds: string[];
  member: { email: string; name: string | null };
  inviteExpiresAt: string | null;
  acceptedAt: string | null;
}

export interface ReceivedShare {
  id: string;
  status: "pending" | "active";
  role: ShareRole;
  includeBudgets: boolean;
  owner: { id: string; name: string | null };
  accountCount: number;
  accountIds: string[];
  inviteExpiresAt: string | null;
}

export interface SharesResponse {
  owned: OwnedShare[];
  received: ReceivedShare[];
}

export interface OwnAccount {
  _id: string;
  name: string;
  type: string;
}

export interface SharedAccounts {
  owner: { id: string; name: string | null };
  role: ShareRole;
  currency: string;
  accounts: { id: string; name: string; type: string; balance: number }[];
}

export interface SharedTransaction {
  id: string;
  account: string | null;
  transferTo: string | null;
  type: "income" | "expense" | "transfer";
  amount: number;
  category: string;
  description: string | null;
  date: string;
  addedBy: { id: string; name: string | null } | null;
}

export interface SharedTransactions {
  currency: string;
  data: SharedTransaction[];
  total: number;
}

export function useShares() {
  return useQuery<SharesResponse>({
    queryKey: ["household", "shares"],
    queryFn: async () => (await apiClient.get<{ data: SharesResponse }>("/household/shares")).data.data,
  });
}

export function useOwnAccounts() {
  return useQuery<OwnAccount[]>({
    queryKey: ["accounts", "list-for-sharing"],
    queryFn: async () => (await apiClient.get<{ data: OwnAccount[] }>("/accounts")).data.data,
  });
}

export function useSharedAccounts(ownerId: string | null) {
  return useQuery<SharedAccounts>({
    queryKey: ["household", "shared", ownerId, "accounts"],
    enabled: Boolean(ownerId),
    queryFn: async () => (await apiClient.get<{ data: SharedAccounts }>(`/household/shared/${ownerId}/accounts`)).data.data,
  });
}

export function useSharedTransactions(ownerId: string | null) {
  return useQuery<SharedTransactions>({
    queryKey: ["household", "shared", ownerId, "transactions"],
    enabled: Boolean(ownerId),
    queryFn: async () =>
      (await apiClient.get<{ data: SharedTransactions }>(`/household/shared/${ownerId}/transactions?limit=20`)).data.data,
  });
}

function useShareMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: ["household"] }),
  });
}

export function useInvite() {
  return useShareMutation(
    async (v: { email: string; accountIds: string[]; role: ShareRole; includeBudgets: boolean }) =>
      (await apiClient.post<{ data: { share: OwnedShare; code: string } }>("/household/shares", v)).data.data
  );
}

export function useUpdateShare() {
  return useShareMutation(async (v: { id: string; role?: ShareRole; includeBudgets?: boolean; accountIds?: string[] }) => {
    const { id, ...body } = v;
    return (await apiClient.patch(`/household/shares/${id}`, body)).data;
  });
}

export function useEndShare() {
  return useShareMutation(async (id: string) => (await apiClient.delete(`/household/shares/${id}`)).data);
}

export function useNewCode() {
  return useShareMutation(
    async (id: string) => (await apiClient.post<{ data: { code: string } }>(`/household/shares/${id}/code`)).data.data
  );
}

export function useAcceptInvite() {
  return useShareMutation(
    async (v: { id: string; code: string }) => (await apiClient.post(`/household/shares/${v.id}/accept`, { code: v.code })).data
  );
}

export function useDeclineInvite() {
  return useShareMutation(async (id: string) => (await apiClient.post(`/household/shares/${id}/decline`)).data);
}
