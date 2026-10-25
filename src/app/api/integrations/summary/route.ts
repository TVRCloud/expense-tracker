import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { getMonthlyStats } from "@/lib/stats-service";
import { listBudgetsWithSpend } from "@/lib/budget-service";
import { getSpendLimitStatusIfConfigured } from "@/lib/spend-limit";
import { getBaseCurrency } from "@/lib/base-currency";

// GET /api/integrations/summary — an automation-oriented snapshot combining
// account balances, this month's income/expense (via the same cached
// aggregation as GET /api/transactions/stats), and budget status. Reuses
// existing calculations only — no numbers are computed a second way here.
export const GET = withIntegrationRoute("summary", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
  const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

  await connectDB();
  const [accounts, baseCurrency, stats, budgets, spendLimit] = await Promise.all([
    Account.find({ user: user.id, isArchived: false })
      .select("_id name type balance currency")
      .lean(),
    getBaseCurrency(user.id),
    getMonthlyStats(user.id, year, month),
    listBudgetsWithSpend(user.id, year, month),
    getSpendLimitStatusIfConfigured(user.id),
  ]);

  return integrationOk(
    {
      // Who this key acts as, so a connected app can show "Connected as <name>".
      user: { name: user.name },
      period: { month, year },
      // Balances are in the base currency; the account's own `currency` is a label.
      accounts: accounts.map((a) => ({ ...a, currency: baseCurrency })),
      stats,
      budgets,
      // Null until the user sets a daily or weekly limit.
      spendLimit,
    },
    requestId
  );
});
