import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { idempotentShareWrite, readShareBody, shareErrorResponse } from "@/lib/integrations/share-http";
import {
  addSharedTransaction,
  listSharedTransactions,
  loadActiveShare,
  sharedTransactionSchema,
} from "@/lib/share-service";
import { TransactionServiceError } from "@/lib/transaction-service";

type Params = Promise<{ ownerId: string }>;

// GET /api/integrations/shared/[ownerId]/transactions?skip&limit&accountId&type&dateFrom&dateTo
// Only rows of the shared accounts, a fixed set of fields (no tags, receipts or capture details),
// at most 50 a page. A transfer to or from an account that is not shared never names it.
export const GET = withIntegrationRoute("shared", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { ownerId } = await ctx.params;
  const shared = await loadActiveShare(user.id, ownerId);
  if (!shared) return integrationError("NOT_FOUND", "Not found", requestId);
  const q = new URL(req.url).searchParams;
  try {
    return integrationOk(
      await listSharedTransactions(shared, {
        skip: parseInt(q.get("skip") ?? "0", 10),
        limit: parseInt(q.get("limit") ?? "20", 10),
        accountId: q.get("accountId"),
        type: q.get("type"),
        dateFrom: q.get("dateFrom"),
        dateTo: q.get("dateTo"),
      }),
      requestId
    );
  } catch (err) {
    const mapped = shareErrorResponse(err, requestId);
    if (mapped) return mapped;
    throw err;
  }
});

// POST /api/integrations/shared/[ownerId]/transactions — an EDITOR adds one plain income or expense
// to a shared account: { accountId, type, amount (paise of the owner's base currency), category,
// description?, note?, date }. Needs an Idempotency-Key. A viewer gets 403; a share that is not
// active, or an account that is not shared, gets 404. Tags, splits, recurrence, transfers and foreign
// amounts are not accepted (400).
export const POST = withIntegrationRoute("shared", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { ownerId } = await ctx.params;
  // Access is checked before the body is read, so a non-member learns nothing from a body or validation error.
  const shared = await loadActiveShare(user.id, ownerId);
  if (!shared) return integrationError("NOT_FOUND", "Not found", requestId);
  const read = await readShareBody(req, requestId);
  if (!read.ok) return read.res;
  const parsed = sharedTransactionSchema.safeParse(read.body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Transaction is invalid", requestId, { details: parsed.error.flatten() });
  }
  try {
    return await idempotentShareWrite({
      req,
      requestId,
      userId: user.id,
      endpoint: `integrations:shared:${ownerId}:transactions:POST`,
      fingerprintBody: parsed.data,
      execute: async () => ({ status: 201, body: { transaction: await addSharedTransaction(shared, user, parsed.data) } }),
    });
  } catch (err) {
    // The owner's own rules can still refuse a write (a base currency this app cannot handle yet).
    if (err instanceof TransactionServiceError) return integrationError("VALIDATION_ERROR", err.message, requestId);
    throw err;
  }
});
