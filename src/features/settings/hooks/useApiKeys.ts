"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { toast } from "sonner";

export type ApiKeyRecord = {
  _id: string;
  label: string;
  lastFour: string;
  revoked: boolean;
  revokedAt?: string | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  lastUsedIp?: string | null;
  createdVia?: "web" | "cli";
  createdAt: string;
};

export type CreatedApiKey = Pick<ApiKeyRecord, "_id" | "label" | "lastFour" | "expiresAt" | "createdAt"> & {
  key: string;
};

export type ApiKeyStatus = "active" | "expired" | "revoked";

export function apiKeyStatus(k: ApiKeyRecord): ApiKeyStatus {
  if (k.revoked) return "revoked";
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

export function useApiKeys() {
  return useQuery<ApiKeyRecord[]>({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ApiKeyRecord[] }>("/me/api-keys");
      return res.data.data;
    },
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label: string; expiresInDays: number | null; currentPassword: string }) =>
      apiClient.post<{ data: CreatedApiKey }>("/me/api-keys", data).then((r) => r.data.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/me/api-keys/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key revoked");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
