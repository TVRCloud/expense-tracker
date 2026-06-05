"use client";

import { useEffect } from "react";
import { useSocketContext } from "@/components/providers/SocketProvider";

export function useSocket<T = unknown>(
  event: string,
  handler: (data: T) => void
) {
  const { socket } = useSocketContext();

  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);

  return useSocketContext();
}
