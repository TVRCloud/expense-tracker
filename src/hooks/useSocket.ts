"use client";

import { useEffect } from "react";
import { useSocketContext } from "@/components/providers/SocketProvider";

export function useSocket<T = unknown>(
  event: string,
  handler: (data: T) => void
) {
  const { subscribe } = useSocketContext();

  useEffect(() => {
    return subscribe(event, handler as (data: unknown) => void);
  }, [subscribe, event, handler]);

  return useSocketContext();
}
