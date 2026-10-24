import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError } from "@/lib/integrations/response";
import { csvResponse, toCsv } from "@/lib/csv";
import { getTaxSummary, TAX_CSV_COLUMNS, taxCsvRows } from "@/lib/tax-service";
import { parseFy } from "@/lib/tax-year";

// GET /api/integrations/tax/export?fy=2025 — the same summary as a CSV file
// (text/csv, not the JSON envelope) the app can share with an accountant.
export const GET = withIntegrationRoute("tax", async ({ req, user, requestId }) => {
  const raw = new URL(req.url).searchParams.get("fy");
  const fy = raw === null ? undefined : parseFy(raw);
  if (fy === null) return integrationError("VALIDATION_ERROR", "fy must be a year such as 2025", requestId);
  const summary = await getTaxSummary(user.id, fy);
  return csvResponse(toCsv(taxCsvRows(summary), TAX_CSV_COLUMNS), `tax-summary-${summary.label}.csv`);
});
