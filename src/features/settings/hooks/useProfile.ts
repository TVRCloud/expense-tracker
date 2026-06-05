"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";
import { type IUser, type UserPreferences } from "@/types/models";
import { toast } from "sonner";

export function useProfile() {
  return useQuery<IUser>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: IUser }>("/me");
      return res.data.data;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<IUser>) => apiClient.patch("/me", data).then((r) => r.data.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      apiClient.patch("/me/password", data),
    onSuccess: () => toast.success("Password changed"),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Record<string, unknown>) =>
      apiClient
        .patch<{ data: { preferences: UserPreferences } }>("/me/preferences", prefs)
        .then((r) => r.data.data.preferences),
    onSuccess: (updatedPrefs) => {
      // Immediately update the cache so every useCurrency() call reflects the new value
      qc.setQueryData<IUser>(["me"], (old) =>
        old ? { ...old, preferences: updatedPrefs } : old
      );
      toast.success("Preferences saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
