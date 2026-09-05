import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { isValidObjectId, listTransactions } from "@/lib/transaction-query";
import { createTransaction, transactionCreateSchema, TransactionServiceError } from "@/lib/transaction-service";
import { withIdempotency } from "@/lib/integrations/idempotency";

const IDEMPOTENCY_ENDPOINT = "integrations:transactions:POST";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/transactions — same filters/pagination as
// GET /api/transactions, via the shared listTransactions() query builder
// (src/lib/transaction-query.ts), including the hideFuture aggregation mode.
export const GET = withIntegrationRoute("transactions", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const skip = Math.max(parseInt(searchParams.get("skip") ?? "0", 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1), 100);
  const type = searchParams.get("type");
  const category = searchParams.get("category");
  const accountId = searchParams.get("accountId");
  const search = searchParams.get("search");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const hideFuture = searchParams.get("hideFuture") === "true";
  const includeUnpaidRecurring = searchParams.get("includeUnpaidRecurring") === "true";

  if (!isValidObjectId(accountId)) {
    return integrationError("VALIDATION_ERROR", "Invalid account", requestId);
  }

  const result = await listTransactions({
    userId: user.id,
    skip,
    limit,
    type,
    category,
    accountId,
    search,
    dateFrom,
    dateTo,
    hideFuture,
    includeUnpaidRecurring,
  });

  return integrationOk(result, requestId);
});

// POST /api/integrations/transactions — calls the exact same
// createTransaction() service as the browser's POST /api/transactions.
// Requires an Idempotency-Key header; retries with the same key + same body
// replay the original response instead of creating a second transaction.
export const POST = withIntegrationRoute("transactions", async ({ req, user, requestId }) => {
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return integrationError(
      "VALIDATION_ERROR",
      "Missing or invalid Idempotency-Key header",
      requestId
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }

  const parsed = transactionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Transaction data is invalid", requestId, {
      details: parsed.error.flatten(),
    });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: IDEMPOTENCY_ENDPOINT,
    key: idempotencyKey,
    body: parsed.data,
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const result = await createTransaction({ ...parsed.data, userId: user.id, actor: user });
        const transaction = result.transaction as {
          _id: { toString(): string };
          type: string;
          amount: number;
          currency: string;
          category: string;
          account: { toString(): string };
          date: Date;
          createdAt: Date;
          updatedAt: Date;
        };
        const responseBody = {
          id: transaction._id.toString(),
          type: transaction.type,
          amount: transaction.amount,
          currency: transaction.currency,
          category: transaction.category,
          accountId: transaction.account.toString(),
          date: transaction.date,
          seriesId: result.kind === "series" ? result.seriesId : null,
          count: result.kind === "series" ? result.count : 1,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
        };
        return { status: 201, body: responseBody };
      } catch (err) {
        if (err instanceof TransactionServiceError) {
          return { status: 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    if (outcome.reason === "fingerprint_mismatch") {
      return integrationError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request body",
        requestId
      );
    }
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (outcome.status === 404 && body_.errorCode) {
    return integrationError("NOT_FOUND", body_.message ?? "Not found", requestId);
  }

  return integrationOk(body_, requestId, { status: outcome.status });
});
