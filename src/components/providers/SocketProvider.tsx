"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

type EventHandler = (data: unknown) => void;

interface SocketContextValue {
  connected: boolean;
  subscribe: (event: string, handler: EventHandler) => () => void;
}

const SocketContext = createContext<SocketContextValue>({
  connected: false,
  subscribe: () => () => {},
});

// Real-time updates via Server-Sent Events backed by MongoDB Change Streams
// (src/app/api/events/route.ts). Native EventSource auto-reconnects on drop —
// including the periodic disconnects Vercel forces once a function's
// maxDuration is hit — so no manual reconnect logic is needed here.
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(new Map<string, Set<EventHandler>>());

  useEffect(() => {
    if (!session?.user?.id) return;

    const es = new EventSource("/api/events");

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

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

  const subscribe = (event: string, handler: EventHandler) => {
    let set = handlersRef.current.get(event);
    if (!set) {
      set = new Set();
      handlersRef.current.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  };

  return (
    <SocketContext.Provider value={{ connected, subscribe }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketContext() {
  return useContext(SocketContext);
}
