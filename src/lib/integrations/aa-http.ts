import { AaServiceError } from "@/lib/aa-service";
import { integrationError } from "@/lib/integrations/response";

/** Answers for the errors the Account Aggregator service throws; anything else is the caller's to rethrow. */
export function aaFailure(err: unknown, requestId: string): Response | null {
  if (!(err instanceof AaServiceError)) return null;
  switch (err.code) {
    case "NOT_CONFIGURED":
      return integrationError("AA_NOT_CONFIGURED", err.message, requestId);
    case "PROVIDER_ERROR":
      return integrationError("AA_PROVIDER_ERROR", err.message, requestId);
    case "NOT_FOUND":
      return integrationError("NOT_FOUND", err.message, requestId);
    case "TOO_SOON":
      return integrationError("RATE_LIMITED", err.message, requestId, err.extra);
    case "VALIDATION":
      return integrationError("VALIDATION_ERROR", err.message, requestId);
    case "LIMIT":
    case "INVALID_STATE":
      return integrationError("CONFLICT", err.message, requestId, { reason: err.code.toLowerCase() });
  }
}
