import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

let io: Server | null = null;

export function getIO(): Server | null {
  return io;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    void handle(req, res, parsedUrl);
  });

  io = new Server(httpServer, {
    path: "/api/socket",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    const userId = socket.handshake.auth.userId as string | undefined;
    if (userId) {
      void socket.join(`user:${userId}`);
    }

    socket.on("join:admin", () => {
      void socket.join("admin:all");
    });

    socket.on("disconnect", () => {
      // cleanup handled automatically
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
