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

export interface PushDevice {
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export function usePushNotification() {
  // Both default to the "not-yet-known" state so server render and first
  // client render match; the real values land after mount via effect below.
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isLoading, setIsLoading] = useState(false);
  const [myEndpoint, setMyEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "Notification" in window &&
      "PushManager" in window &&
      "serviceWorker" in navigator;
    setIsSupported(supported);
    if (supported) setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (!isSupported || permission !== "granted") return;
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setMyEndpoint(sub?.endpoint ?? null));
  }, [isSupported, permission]);

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ["push-status"],
    queryFn: async () => {
      const res = await apiClient.get<{ hasSubscription: boolean; count: number; devices: PushDevice[] }>("/push/status");
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
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      const reg = await withTimeout(
        navigator.serviceWorker.ready,
        10000,
        "Service worker isn't ready. Try reloading the page."
      );
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
        userAgent: navigator.userAgent,
      });
      setMyEndpoint(json.endpoint);
      await refetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable push notifications");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, refetchStatus]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    setError(null);
    try {
      const reg = await withTimeout(
        navigator.serviceWorker.ready,
        10000,
        "Service worker isn't ready. Try reloading the page."
      );
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiClient.delete("/push/unsubscribe", { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setMyEndpoint(null);
      await refetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable push notifications");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, refetchStatus]);

  const sendTestMutation = useMutation({
    mutationFn: () => {
      if (!myEndpoint) throw new Error("This device isn't subscribed yet");
      return apiClient.post("/push/test", { endpoint: myEndpoint });
    },
  });

  return {
    status,
    isLoading: isLoading || sendTestMutation.isPending,
    error,
    subscribe,
    unsubscribe,
    sendTest: () => sendTestMutation.mutateAsync(),
    myEndpoint,
    devices: statusData?.devices ?? [],
  };
}
