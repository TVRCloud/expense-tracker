import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { budgetCreateSchema, BudgetServiceError, createBudget, listBudgetsWithSpend } from "@/lib/budget-service";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/budgets — reuses the exact spend-aggregation shared
// with GET /api/budgets (src/lib/budget-service.ts) so both surfaces report
// identical numbers. Uncached, matching the existing (uncached) budgets route.
export const GET = withIntegrationRoute("budgets", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

  const budgets = await listBudgetsWithSpend(user.id, year, month);
  return integrationOk(budgets, requestId);
});

// POST /api/integrations/budgets — reuses the exact same createBudget()
// service as the browser's POST /api/budgets.
export const POST = withIntegrationRoute("budgets", async ({ req, user, requestId }) => {
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
  const parsed = budgetCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Budget data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:budgets:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => {
      try {
        const budget = await createBudget({ ...parsed.data, userId: user.id, actor: user });
        return { status: 201, body: budget as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof BudgetServiceError) {
          return { status: 409, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
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

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError("CONFLICT", body_.message ?? "Budget already exists", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
