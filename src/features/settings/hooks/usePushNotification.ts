"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import apiClient from "@/lib/api-client";

export type PushStatus = "unsupported" | "blocked" | "disabled" | "enabled" | "loading";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function usePushNotification() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isLoading, setIsLoading] = useState(false);

  const isSupported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator;

  useEffect(() => {
    if (isSupported) {
      setPermission(Notification.permission);
    }
  }, [isSupported]);

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ["push-status"],
    queryFn: async () => {
      const res = await apiClient.get<{ hasSubscription: boolean; count: number }>("/push/status");
      return res.data;
    },
    enabled: isSupported && permission === "granted",
  });

  const status: PushStatus = (() => {
    if (!isSupported) return "unsupported";
    if (permission === "denied") return "blocked";
    if (permission === "granted" && statusData?.hasSubscription) return "enabled";
    return "disabled";
  })();

  const subscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("VAPID public key not configured");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await apiClient.post("/push/subscribe", {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      await refetchStatus();
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, refetchStatus]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiClient.delete("/push/unsubscribe", { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      await refetchStatus();
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, refetchStatus]);

  const sendTestMutation = useMutation({
    mutationFn: () => apiClient.post("/push/test"),
  });

  return {
    status,
    isLoading: isLoading || sendTestMutation.isPending,
    subscribe,
    unsubscribe,
    sendTest: () => sendTestMutation.mutate(),
  };
}
