import type { Server } from "socket.io";

let _io: Server | null = null;

export const setIO = (io: Server) => {
  _io = io;
};

export const getIO = () => _io;
