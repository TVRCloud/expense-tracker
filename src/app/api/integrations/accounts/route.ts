import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { accountCreateSchema, createAccount } from "@/lib/account-service";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/accounts — uncached, matching the existing (uncached)
// GET /api/accounts. Returns the accounts n8n needs to pick a destination for
// a new transaction.
export const GET = withIntegrationRoute("accounts", async ({ user, requestId }) => {
  await connectDB();
  const accounts = await Account.find({ user: user.id, isArchived: false })
    .sort({ createdAt: -1 })
    .select("_id name type balance currency color icon createdAt updatedAt")
    .lean();

  return integrationOk(accounts, requestId);
});

// POST /api/integrations/accounts — reuses the exact same createAccount()
// service as the browser's POST /api/accounts. `balance` is the opening
// balance in cents; later changes only come from transactions.
export const POST = withIntegrationRoute("accounts", async ({ req, user, requestId }) => {
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = accountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Account data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:accounts:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => {
      const account = await createAccount({ ...parsed.data, userId: user.id, actor: user });
      return { status: 201, body: account as unknown as Record<string, unknown> };
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      outcome.reason === "fingerprint_mismatch"
        ? "Idempotency-Key was already used with a different request body"
        : "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }

  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
