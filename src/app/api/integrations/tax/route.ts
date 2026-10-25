import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { getTaxSummary } from "@/lib/tax-service";
import { parseFy } from "@/lib/tax-year";

// GET /api/integrations/tax?fy=2025 — financial-year summary (1 April to
// 31 March in the user's time zone): income, spending, saved, deductible
// spending by category, per month totals. Without `fy`, the current year.
export const GET = withIntegrationRoute("tax", async ({ req, user, requestId }) => {
  const raw = new URL(req.url).searchParams.get("fy");
  const fy = raw === null ? undefined : parseFy(raw);
  if (fy === null) return integrationError("VALIDATION_ERROR", "fy must be a year such as 2025", requestId);
  return integrationOk(await getTaxSummary(user.id, fy), requestId);
});
