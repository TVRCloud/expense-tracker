import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { getDailyTotals, getMonthlyStats, getRangeStats, parseMonthList } from "@/lib/stats-service";

// GET /api/integrations/stats?month&year[&months=2026-9,2026-10]
// Month totals and category breakdown come from the same getMonthlyStats()
// as GET /api/transactions/stats, so the numbers match the web analytics
// page. `daily` is one entry per day of the month (zeros included). `history`
// (only when `months` is given) is the multi-month trend, same rules as
// GET /api/transactions/stats/range. Uncached, like the other integration reads.
export const GET = withIntegrationRoute("stats", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020) {
    return integrationError("VALIDATION_ERROR", "month must be 1-12 and year 2020 or later", requestId);
  }

  const monthsParam = searchParams.get("months");
  const months = parseMonthList(monthsParam);
  if (monthsParam && months.length === 0) {
    return integrationError("VALIDATION_ERROR", "months must look like 2026-9,2026-10", requestId);
  }

  const [stats, daily, history] = await Promise.all([
    getMonthlyStats(user.id, year, month),
    getDailyTotals(user.id, year, month),
    monthsParam ? getRangeStats(user.id, months) : Promise.resolve(undefined),
  ]);

  return integrationOk({ month, year, ...stats, daily, ...(history ? { history } : {}) }, requestId);
});
