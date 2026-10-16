import type { NextRequest } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import logger from "@/lib/logger";
import { watchUserChanges, type UserChangeWatcher } from "@/lib/realtime/changes";

export const HEARTBEAT_MS = 20_000;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export function formatSse(event: string, data: unknown, id?: number): string {
  return `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Builds the SSE Response shared by both realtime routes. Emits `ready`
 * first, then `data-changed` per change, and `ping` every 20s. Returns null
 * when the database isn't ready (caller answers 503 in its own envelope).
 */
export async function createRealtimeResponse(
  req: NextRequest,
  userId: string,
  readyPayload: () => unknown
): Promise<Response | null> {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) return null;

  const encoder = new TextEncoder();
  let closed = false;
  let watcher: UserChangeWatcher | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let counter = 0;
  let controllerRef: ReadableStreamDefaultController | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    void watcher?.close();
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSse(event, data, ++counter)));
        } catch {
          // controller already closed mid-write; ignore
        }
      };

      // Opening comment flushes the connection open through buffering proxies.
      controller.enqueue(encoder.encode(": connected\n\n"));
      send("ready", readyPayload());

      try {
        watcher = watchUserChanges(
          db,
          userId,
          (resource) => send("data-changed", { resource }),
          // Dead cursor: end the response so the client reconnects and
          // refetches everything instead of sitting on a silent stream.
          () => cleanup()
        );
      } catch (err) {
        logger.error(`Failed to open change stream: ${(err as Error).message}`);
        cleanup();
        return;
      }

      heartbeat = setInterval(() => send("ping", {}), HEARTBEAT_MS);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
