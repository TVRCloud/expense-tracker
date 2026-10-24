import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { getSplit, replaceSplits, splitUpdateSchema } from "@/lib/split-service";
import { TransactionServiceError } from "@/lib/transaction-service";

type Ctx = { params: Promise<{ id: string }> };

function errorCode(code: string) {
  if (code === "TRANSACTION_NOT_FOUND") return "NOT_FOUND" as const;
  if (code === "TRANSACTION_LOCKED" || code === "SPLIT_CONFLICT" || code === "TOO_MANY_RECEIPTS") return "CONFLICT" as const;
  return "VALIDATION_ERROR" as const;
}

// GET /api/integrations/transactions/[id]/splits — the lines of a split (any line's id works),
// or the single line of a plain transaction.
export const GET = withIntegrationRoute("transactions", async ({ user, requestId }, ctx: Ctx) => {
  const { id } = await ctx.params;
  try {
    return integrationOk(await getSplit(user.id, id), requestId);
  } catch (err) {
    if (err instanceof TransactionServiceError) return integrationError(errorCode(err.code), err.message, requestId);
    throw err;
  }
});

// PUT /api/integrations/transactions/[id]/splits — replace the lines. Needs 2 to 20 lines that add
// up to the transaction's total. A plain expense becomes a split. Balances do not move.
export const PUT = withIntegrationRoute("transactions", async ({ req, user, requestId }, ctx: Ctx) => {
  const { id } = await ctx.params;
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const json = await readJsonBody(req);
  if (!json.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = splitUpdateSchema.safeParse(json.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Split data is invalid", requestId, { details: parsed.error.flatten() });
  }

  let outcome;
  try {
    outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:transactions:splits:PUT",
      key,
      // Flat on purpose: the fingerprint only reads top-level keys, so the lines go in as one string.
      body: { id, splits: JSON.stringify(parsed.data.splits) },
      execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
        try {
          const result = await replaceSplits({ userId: user.id, transactionId: id, splits: parsed.data.splits, actor: user });
          return { status: 200, body: result };
        } catch (err) {
          // A clash with another edit is not stored under the key, so the same key can be tried again.
          if (err instanceof TransactionServiceError && err.code !== "SPLIT_CONFLICT") {
            return { status: 400, body: { errorCode: err.code, message: err.message } };
          }
          throw err;
        }
      },
    });
  } catch (err) {
    if (err instanceof TransactionServiceError && err.code === "SPLIT_CONFLICT") {
      return integrationError("CONFLICT", err.message, requestId);
    }
    throw err;
  }
  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const body = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body.errorCode) return integrationError(errorCode(body.errorCode), body.message ?? "Request failed", requestId);
  return integrationOk(body, requestId, { status: outcome.status });
});
