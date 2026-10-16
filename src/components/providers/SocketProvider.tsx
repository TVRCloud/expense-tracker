"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

type EventHandler = (data: unknown) => void;

interface SocketContextValue {
  connected: boolean;
  subscribe: (event: string, handler: EventHandler) => () => void;
  /** Runs each time the stream (re)opens after having been closed/errored. Not on the first open. */
  onReconnect: (handler: () => void) => () => void;
}

const SocketContext = createContext<SocketContextValue>({
  connected: false,
  subscribe: () => () => {},
  onReconnect: () => () => {},
});

// Real-time updates via Server-Sent Events backed by MongoDB Change Streams
// (src/app/api/events/route.ts). Native EventSource auto-reconnects on drop —
// including the periodic disconnects Vercel forces once a function's
// maxDuration is hit — so no manual reconnect logic is needed here.
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(new Map<string, Set<EventHandler>>());
  const reconnectRef = useRef(new Set<() => void>());

  useEffect(() => {
    if (!session?.user?.id) return;

    const es = new EventSource("/api/events");
    let hasOpened = false;
    let wasDown = false;

    es.onopen = () => {
      setConnected(true);
      // Reopen after a drop (e.g. Vercel's maxDuration cut): events during
      // the gap were missed, so let listeners refetch.
      if (hasOpened && wasDown) for (const h of reconnectRef.current) h();
      hasOpened = true;
      wasDown = false;
    };
    es.onerror = () => {
      setConnected(false);
      wasDown = true;
    };

    es.addEventListener("data-changed", (e: MessageEvent) => {
      let data: unknown = null;
      try {
        data = JSON.parse(e.data as string);
      } catch {
        return;
      }
      for (const handler of handlersRef.current.get("data-changed") ?? []) {
        handler(data);
      }
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [session?.user?.id]);

  const subscribe = useCallback((event: string, handler: EventHandler) => {
    let set = handlersRef.current.get(event);
    if (!set) {
      set = new Set();
      handlersRef.current.set(event, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }, []);

  const onReconnect = useCallback((handler: () => void) => {
    reconnectRef.current.add(handler);
    return () => {
      reconnectRef.current.delete(handler);
    };
  }, []);

  const value = useMemo(() => ({ connected, subscribe, onReconnect }), [connected, subscribe, onReconnect]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketContext() {
  return useContext(SocketContext);
}
