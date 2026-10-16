"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocketContext } from "@/components/providers/SocketProvider";
import { invalidateForResource, isRealtimeResource } from "@/lib/realtime/invalidation";

// Mounted once in the root layout. Turns server `data-changed` events into
// TanStack invalidations for every screen, and refetches everything when the
// EventSource reconnects (changes during the reconnect gap were never seen).
export function RealtimeSync() {
  const qc = useQueryClient();
  const { subscribe, onReconnect } = useSocketContext();

  useEffect(() => {
    return subscribe("data-changed", (data) => {
      const resource = (data as { resource?: unknown } | null)?.resource;
      if (isRealtimeResource(resource)) invalidateForResource(qc, resource);
    });
  }, [qc, subscribe]);

  useEffect(() => {
    return onReconnect(() => {
      void qc.invalidateQueries();
    });
  }, [qc, onReconnect]);

  return null;
}
