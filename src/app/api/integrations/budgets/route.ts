import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { listBudgetsWithSpend } from "@/lib/budget-service";

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
