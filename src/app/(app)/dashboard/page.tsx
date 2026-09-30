import type { Metadata } from "next";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getServerSession } from "next-auth";
import { DashboardClient } from "@/features/dashboard/components/DashboardClient";
import { authOptions } from "@/lib/auth-options";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import User from "@/models/User";
import { getMonthlyStats } from "@/lib/stats-service";
import { listTransactions } from "@/lib/transaction-query";
import { makeQueryClient } from "@/lib/query-client";
import logger from "@/lib/logger";

export const metadata: Metadata = { title: "Dashboard" };

// The same values the API routes return, in the same JSON shape (ObjectIds
// and Dates as strings), so the cache the client hydrates from is exactly
// what its own fetch would have produced.
const asJson = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Server-rendered first paint: the dashboard's first queries run here, in
// parallel and next to the database, and ship with the HTML. Before, the
// browser had to load and hydrate the JS, then fetch the session, then fire
// each query, before any number appeared. Keys match the client hooks
// (useDashboard.ts, useProfile.ts); anything that fails here the client
// simply fetches itself.
export default async function DashboardPage() {
  const qc = makeQueryClient();
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (userId && session.error !== "SessionTerminated") {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      await connectDB();
      const [stats, recent, accounts, me] = await Promise.all([
        getMonthlyStats(userId, year, month),
        listTransactions({ userId, skip: 0, limit: 6, hideFuture: true, includeTotal: false }),
        Account.find({ user: userId, isArchived: false }).sort({ createdAt: -1 }).lean(),
        User.findById(userId).select("-password -passwordResetToken -passwordResetExpires").lean(),
      ]);
      qc.setQueryData(["transactions", "stats", month, year], asJson(stats));
      qc.setQueryData(["transactions", "recent", 6], asJson(recent.data));
      qc.setQueryData(["accounts"], asJson(accounts));
      if (me) qc.setQueryData(["me"], asJson(me));
    }
  } catch (err) {
    logger.error({ err }, "dashboard prefetch failed; client will fetch");
  }

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}
