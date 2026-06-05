"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | undefined;

export function getSocket(userId: string): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? "", {
      path: "/api/socket",
      autoConnect: false,
      auth: { userId },
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket?.connected) socket.disconnect();
  socket = undefined;
}
