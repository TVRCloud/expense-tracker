import type { NextRequest } from "next/server";
import logger from "@/lib/logger";
import type { AuthUser } from "@/lib/auth-guard";
import { resolveRequestId } from "@/lib/integrations/request-id";
import { verifyN8nAuth } from "@/lib/integrations/auth";
import { checkRouteRateLimit } from "@/lib/integrations/rate-limit";
import { integrationError } from "@/lib/integrations/response";

// Common request lifecycle for every /api/integrations/* route: correlation
// ID, n8n auth, per-route rate limiting, and safe error logging. Keeps each
// route handler focused on its own business logic (parsing/validation/calling
// the shared service) rather than repeating this plumbing five times.
export function withIntegrationRoute(
  routeName: string,
  handler: (ctx: { req: NextRequest; user: AuthUser; requestId: string }) => Promise<Response>
) {
  return async function routeHandler(req: NextRequest): Promise<Response> {
    const requestId = resolveRequestId(req);
    const start = Date.now();

    const auth = await verifyN8nAuth(req, requestId);
    if ("errorResponse" in auth) return auth.errorResponse;

    const rateLimit = await checkRouteRateLimit(routeName, auth.user.id);
    if (!rateLimit.allowed) {
      logger.warn({ requestId, route: routeName, userId: auth.user.id }, "n8n route rate limit exceeded");
      return integrationError("RATE_LIMITED", "Rate limit exceeded", requestId, {
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    try {
      const res = await handler({ req, user: auth.user, requestId });
      logger.info(
        { requestId, route: routeName, method: req.method, status: res.status, durationMs: Date.now() - start },
        "n8n integration request handled"
      );
      return res;
    } catch (err) {
      logger.error(
        { err, requestId, route: routeName, method: req.method, durationMs: Date.now() - start },
        "n8n integration request failed"
      );
      return integrationError("INTERNAL_ERROR", "Internal server error", requestId);
    }
  };
}
