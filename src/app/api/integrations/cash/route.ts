import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { cashSetupSchema, getCashSummary, setupCash } from "@/lib/cash-service";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/cash — the user's cash account and a low-cash view:
// balance, the low-cash line (set or default), whether the balance is at or
// under it, 30 days of withdrawals (transfers into cash) and cash spending,
// and the latest withdrawals. `account` is null until a cash account exists.
export const GET = withIntegrationRoute("cash", async ({ user, requestId }) => {
  return integrationOk(await getCashSummary(user.id), requestId);
});

// POST /api/integrations/cash — make sure the user has a cash account (created
// on first call, 201) and apply `name` and `lowBalanceAt`. Calling it again
// updates those two and answers 200. `openingBalance` only counts when the
// account is created. Returns the same summary as GET.
export const POST = withIntegrationRoute("cash", async ({ req, user, requestId }) => {
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
  const parsed = cashSetupSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Cash account data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:cash:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => {
      const { summary, created } = await setupCash({ ...parsed.data, userId: user.id, actor: user });
      return { status: created ? 201 : 200, body: summary as unknown as Record<string, unknown> };
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
