import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { createRealtimeResponse } from "@/lib/realtime/sse";

// Long-lived SSE stream backed by a single MongoDB Change Stream (see
// src/lib/realtime/changes.ts). Replaces the old socket.io setup, which relied
// on a custom persistent server (server.ts) that Vercel can't run. Vercel caps
// how long a function may stay open; when that hits, the connection is cut and
// the browser's native EventSource reconnects (SocketProvider then refetches
// everything to cover the gap).
//
// Events: `ready` {resource:null}, `data-changed` {resource}, `ping` {}.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const res = await createRealtimeResponse(req, user.id, () => ({ resource: null }));
  return res ?? new Response("Database not ready", { status: 503 });
}
