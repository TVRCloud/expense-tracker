import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { getMonthlyStats } from "@/lib/stats-service";
import { listTransactions } from "@/lib/transaction-query";
import { getReviewCounts } from "@/lib/reconcile/inbox";

// GET /api/integrations/home — everything a connected app's home screen
// needs in one request: accounts, this month's stats, the latest few
// transactions and the review counts. Each piece comes from the same shared
// function as its own endpoint (summary, transactions?hideFuture=true,
// review), so the numbers always agree; it just saves the app three extra
// round trips (and three auth checks) on launch.
export const GET = withIntegrationRoute("home", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const latestLimit = Math.min(Math.max(parseInt(searchParams.get("latest") ?? "3", 10) || 3, 1), 20);
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  await connectDB();
  const [accounts, stats, latest, reviewCounts] = await Promise.all([
    Account.find({ user: user.id, isArchived: false }).select("_id name type balance currency").lean(),
    getMonthlyStats(user.id, year, month),
    listTransactions({ userId: user.id, skip: 0, limit: latestLimit, hideFuture: true, includeTotal: false }),
    getReviewCounts(user.id),
  ]);

  return integrationOk(
    {
      user: { name: user.name },
      period: { month, year },
      accounts,
      stats,
      latest: latest.data,
      reviewCounts,
    },
    requestId
  );
});
