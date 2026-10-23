import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { createLoan, listLoans, LoanServiceError, loanCreateSchema } from "@/lib/loan-service";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

function requireIdempotencyKey(req: NextRequest) {
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  return key;
}

function conflictMessage(reason: string) {
  return reason === "fingerprint_mismatch"
    ? "Idempotency-Key was already used with a different request"
    : "A request with this Idempotency-Key is still in progress; retry shortly";
}

// GET /api/integrations/loans — same query as GET /api/loans (filters:
// direction, isSettled), uncached.
export const GET = withIntegrationRoute("loans", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const loans = await listLoans(user.id, {
    direction: searchParams.get("direction"),
    isSettled: searchParams.get("isSettled"),
  });
  return integrationOk(loans, requestId);
});

// POST /api/integrations/loans — reuses createLoan() from src/lib/loan-service.ts,
// the same service as the browser's POST /api/loans.
export const POST = withIntegrationRoute("loans", async ({ req, user, requestId }) => {
  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = loanCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Loan data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:loans:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const loan = await createLoan({ ...parsed.data, userId: user.id, actor: user });
        return { status: 201, body: loan as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof LoanServiceError) {
          return { status: 404, body: { errorCode: err.code, message: err.message } };
        }
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }

  const body_ = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (body_.errorCode) {
    return integrationError("NOT_FOUND", body_.message ?? "Account not found", requestId);
  }
  return integrationOk(body_, requestId, { status: outcome.status });
});
