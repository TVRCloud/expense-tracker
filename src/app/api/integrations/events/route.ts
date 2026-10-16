import type { NextRequest } from "next/server";
import { resolveRequestId } from "@/lib/integrations/request-id";
import { verifyN8nAuth } from "@/lib/integrations/auth";
import { checkRouteRateLimit } from "@/lib/integrations/rate-limit";
import { integrationError } from "@/lib/integrations/response";
import { createRealtimeResponse } from "@/lib/realtime/sse";
import logger from "@/lib/logger";

// GET /api/integrations/events — SSE stream for the mobile app, API-key auth.
// Not wrapped in withIntegrationRoute: that wrapper logs/returns once the
// handler resolves, which for a long-lived stream is fine for errors but we
// want the same auth + rate-limit steps with a streaming Response.
//
// Events (names/shapes are a contract with the Flutter app):
//   ready         {"now": <epoch ms>}
//   data-changed  {"resource": "transactions|accounts|budgets|goals|loans|notifications|captures"}
//   ping          {}   every 20s
// Vercel cuts the function at maxDuration; the app must reconnect and call
// GET /api/integrations/changes?since=<last now> to catch up.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const requestId = resolveRequestId(req);

  const auth = await verifyN8nAuth(req, requestId);
  if ("errorResponse" in auth) return auth.errorResponse;

  const rateLimit = await checkRouteRateLimit("events", auth.apiKeyId);
  if (!rateLimit.allowed) {
    return integrationError("RATE_LIMITED", "Rate limit exceeded", requestId, {
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  try {
    const res = await createRealtimeResponse(req, auth.user.id, () => ({ now: Date.now() }));
    if (!res) return integrationError("INTERNAL_ERROR", "Database not ready", requestId);
    res.headers.set("X-Request-ID", requestId);
    return res;
  } catch (err) {
    logger.error({ err, requestId, route: "events" }, "integration events stream failed");
    return integrationError("INTERNAL_ERROR", "Internal server error", requestId);
  }
}
