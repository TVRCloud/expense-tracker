import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { resolveAnomaly, resolveAnomalySchema } from "@/lib/anomaly-service";

type Params = Promise<{ id: string }>;

// PATCH /api/integrations/anomalies/:id — { status: "this_was_me" | "report" | "dismiss" }.
// "report" also tags the expense `anomaly-reported` (when it has room for a tag);
// nothing else happens automatically. 404 for another user's alert.
export const PATCH = withIntegrationRoute("anomalies", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return integrationError("VALIDATION_ERROR", "Invalid alert id", requestId);
  const idempotencyKey = idempotencyKeyOf(req as NextRequest);
  if (!idempotencyKey) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = resolveAnomalySchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Send status as this_was_me, report or dismiss", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:anomaly:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async () => {
      const result = await resolveAnomaly(user.id, id, parsed.data.status);
      return result
        ? { status: 200, body: result as unknown as Record<string, unknown> }
        : { status: 404, body: { errorCode: "NOT_FOUND", message: "Alert not found" } };
    },
  });
  if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  if (outcome.status === 404) return integrationError("NOT_FOUND", "Alert not found", requestId);
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
