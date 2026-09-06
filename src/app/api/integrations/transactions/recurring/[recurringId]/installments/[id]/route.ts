import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { TransactionServiceError, setInstallmentStatus, type InstallmentStatus } from "@/lib/transaction-service";
import { z } from "zod";

type Params = Promise<{ recurringId: string; id: string }>;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const patchSchema = z.object({ status: z.enum(["paid", "skipped", "upcoming", "overdue"]) });

// PATCH /api/integrations/transactions/recurring/[recurringId]/installments/[id]
// — reuses the exact same balance-apply/reverse logic as the browser route
// (src/lib/transaction-service.ts setInstallmentStatus).
export const PATCH = withIntegrationRoute(
  "transactions",
  async ({ req, user, requestId }, ctx: { params: Params }) => {
    const { recurringId, id } = await ctx.params;

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
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return integrationError("VALIDATION_ERROR", "Status is invalid", requestId, { details: parsed.error.flatten() });
    }

    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:installments:PATCH",
      key: idempotencyKey,
      body: { recurringId, id, status: parsed.data.status },
      execute: async () => {
        try {
          const installment = await setInstallmentStatus(
            user.id,
            recurringId,
            id,
            parsed.data.status as InstallmentStatus,
            user
          );
          return { status: 200, body: installment as unknown as Record<string, unknown> };
        } catch (err) {
          if (err instanceof TransactionServiceError) {
            return { status: 400, body: { errorCode: err.code, message: err.message } };
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
      const status = body_.errorCode === "INSTALLMENT_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR";
      return integrationError(status, body_.message ?? "Request failed", requestId);
    }
    return integrationOk(body_, requestId, { status: outcome.status });
  }
);
