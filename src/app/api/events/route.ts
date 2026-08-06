import { NextRequest } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

// Long-lived SSE stream backed by MongoDB Change Streams. Replaces the old
// socket.io setup, which relied on a custom persistent server (server.ts) —
// something Vercel's serverless functions can't run. Vercel caps how long a
// function may stay open (plan-dependent: Hobby ~10s, Pro up to 300s); when
// that hits, this connection is cut and the browser's native EventSource
// reconnects automatically. No client-side reconnect logic needed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WATCHED_COLLECTIONS = [
  { name: "transactions", resource: "transactions" },
  { name: "accounts", resource: "accounts" },
] as const;

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) return new Response("Database not ready", { status: 503 });

  const encoder = new TextEncoder();
  const userObjectId = new mongoose.Types.ObjectId(user.id);

  let closed = false;
  const changeStreams: mongoose.mongo.ChangeStream[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed mid-write; ignore
        }
      };

      // Opening comment — some proxies buffer the response until the first
      // byte, this flushes the connection open immediately.
      controller.enqueue(encoder.encode(": connected\n\n"));

      for (const { name, resource } of WATCHED_COLLECTIONS) {
        // Deletes don't carry fullDocument (no pre-image on shared/free Atlas
        // tiers), so we can't filter those by owner — forward them
        // unconditionally. Payload only ever says "this resource changed",
        // never leaks data, so an occasional cross-user refetch is harmless.
        const pipeline = [
          {
            $match: {
              $or: [
                {
                  operationType: { $in: ["insert", "update", "replace"] },
                  "fullDocument.user": userObjectId,
                },
                { operationType: "delete" },
              ],
            },
          },
        ];

        try {
          const cs = db.collection(name).watch(pipeline, { fullDocument: "updateLookup" });
          changeStreams.push(cs);
          cs.on("change", () => send("data-changed", { resource }));
          cs.on("error", (err: Error) => {
            logger.error(`Change stream error (${name}): ${err.message}`);
          });
        } catch (err) {
          logger.error(`Failed to open change stream (${name}): ${(err as Error).message}`);
        }
      }

      // Keep intermediary proxies/load balancers from timing out an idle connection
      heartbeat = setInterval(() => send("ping", {}), 20000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        for (const cs of changeStreams) void cs.close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      for (const cs of changeStreams) void cs.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
