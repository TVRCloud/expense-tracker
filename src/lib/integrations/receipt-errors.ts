import type { IntegrationErrorCode } from "@/lib/integrations/response";
import type { ReceiptServiceErrorCode } from "@/lib/receipt-service";

// Which integration error code a receipt-service error maps to.
export function receiptIntegrationCode(code: ReceiptServiceErrorCode): IntegrationErrorCode {
  if (code === "TRANSACTION_NOT_FOUND" || code === "RECEIPT_NOT_FOUND") return "NOT_FOUND";
  if (code === "TOO_MANY" || code === "QUOTA_EXCEEDED") return "CONFLICT";
  if (code === "UNREADABLE") return "INTERNAL_ERROR";
  return "VALIDATION_ERROR";
}
