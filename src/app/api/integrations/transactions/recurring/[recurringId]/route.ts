import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { cancelRecurringSeries, getRecurringSeries } from "@/lib/recurring-series";

type Params = Promise<{ recurringId: string }>;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/transactions/recurring/[recurringId] — every installment
// plus the series summary, same as the browser's GET (src/lib/recurring-series.ts).
export const GET = withIntegrationRoute("transactions", async ({ user, requestId }, ctx: { params: Params }) => {
  const { recurringId } = await ctx.params;
  if (!Types.ObjectId.isValid(recurringId)) {
    return integrationError("VALIDATION_ERROR", "Invalid recurringId", requestId);
  }
  const found = await getRecurringSeries(user.id, recurringId);
  if (!found) return integrationError("NOT_FOUND", "Series not found", requestId);
  return integrationOk({ installments: found.installments, series: found.series }, requestId);
});

// DELETE /api/integrations/transactions/recurring/[recurringId] — cancels the
// unpaid installments and stops the series regenerating, same as the browser's
// DELETE. Paid installments stay. Cancelling an already cancelled series
// returns deletedCount 0.
export const DELETE = withIntegrationRoute("transactions", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { recurringId } = await ctx.params;
  if (!Types.ObjectId.isValid(recurringId)) {
    return integrationError("VALIDATION_ERROR", "Invalid recurringId", requestId);
  }

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:transactions:recurring:DELETE",
    key: idempotencyKey,
    body: { recurringId },
    execute: async () => {
      const result = await cancelRecurringSeries(user.id, recurringId, user);
      return { status: 200, body: { recurringId, ...result } };
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      outcome.reason === "fingerprint_mismatch"
        ? "Idempotency-Key was already used with a different request"
        : "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
