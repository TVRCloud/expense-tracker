import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { deductibleFlagSchema } from "@/lib/tax-settings";
import { setTransactionDeductible } from "@/lib/tax-service";

type Params = Promise<{ id: string }>;

// PATCH /api/integrations/tax/transactions/:id — { deductible: true | false | null }.
// true or false overrides the category rule for this expense, null goes back to
// it. 404 for another user's row, a deleted row or anything that is not an expense.
export const PATCH = withIntegrationRoute("tax", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return integrationError("VALIDATION_ERROR", "Invalid transaction id", requestId);
  const idempotencyKey = idempotencyKeyOf(req as NextRequest);
  if (!idempotencyKey) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = deductibleFlagSchema.safeParse(read.body);
  if (!parsed.success) return integrationError("VALIDATION_ERROR", "Send deductible as true, false or null", requestId);

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:tax-transaction:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async () => {
      const result = await setTransactionDeductible(user.id, id, parsed.data.deductible);
      return result
        ? { status: 200, body: result as unknown as Record<string, unknown> }
        : { status: 404, body: { errorCode: "NOT_FOUND", message: "Expense not found" } };
    },
  });
  if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  if (outcome.status === 404) return integrationError("NOT_FOUND", "Expense not found", requestId);
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
