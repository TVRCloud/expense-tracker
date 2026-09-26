import { NextResponse, type NextRequest } from "next/server";
import { ReconcileError } from "@/lib/reconcile/correct";
import { TransactionServiceError } from "@/lib/transaction-service";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import logger from "@/lib/logger";

// Error mapping shared by the reconcile routes: the web routes answer in the
// app's {data}/{error} shape, the phone's integration routes in the
// {success, data | error, requestId} shape.

function statusOf(err: ReconcileError | TransactionServiceError) {
  if (err instanceof TransactionServiceError) {
    return err.code === "TRANSACTION_LOCKED" ? 409 : 404;
  }
  switch (err.code) {
    case "NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
      return 404;
    case "NO_CHANGES":
      return 400;
    default:
      return 409;
  }
}

export function webReconcileError(err: unknown, route: string) {
  if (err instanceof ReconcileError || err instanceof TransactionServiceError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: statusOf(err) });
  }
  logger.error({ err }, `${route} failed`);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

function integrationCode(status: number) {
  if (status === 404) return "NOT_FOUND" as const;
  if (status === 400) return "VALIDATION_ERROR" as const;
  return "CONFLICT" as const;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

/**
 * Runs a mutating review action for the phone behind the Idempotency-Key
 * layer, so a retried request (flaky mobile network) never applies a
 * correction twice. The header is required.
 */
export async function integrationReviewMutation(params: {
  req: NextRequest;
  userId: string;
  requestId: string;
  endpoint: string;
  body: unknown;
  execute: () => Promise<Record<string, unknown>>;
}) {
  const key = params.req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", params.requestId);
  }

  const outcome = await withIdempotency({
    userId: params.userId,
    endpoint: params.endpoint,
    key,
    body: params.body ?? {},
    execute: async () => {
      try {
        return { status: 200, body: await params.execute() };
      } catch (err) {
        if (err instanceof ReconcileError || err instanceof TransactionServiceError) {
          return { status: statusOf(err), body: { errorCode: err.code, message: err.message } };
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
      params.requestId
    );
  }
  const body = outcome.body as Record<string, unknown>;
  if (outcome.status >= 400) {
    return integrationError(integrationCode(outcome.status), String(body.message ?? "Request failed"), params.requestId, {
      reason: body.errorCode,
    });
  }
  return integrationOk(body, params.requestId);
}
