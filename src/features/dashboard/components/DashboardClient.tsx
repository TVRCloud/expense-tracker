"use client";

import Link from "next/link";
import { useDashboardStats, useRecentTransactions, useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { BalanceCard } from "./SpendCard";
import { WalletCard } from "./WalletCard";
import { CreditCardSummaryWidget } from "@/features/credit-cards/components/CreditCardSummaryWidget";
import { UpcomingPaymentsWidget } from "@/features/recurring/components/UpcomingPaymentsWidget";
import { TransactionRow } from "@/features/transactions/components/TransactionRow";
import { useCurrency } from "@/hooks/useCurrency";
import { StaggerContainer, StaggerItem } from "@/components/shared/StaggerContainer";


function SkeletonCard({ h = 110 }: { h?: number }) {
  return (
    <div
      className="rounded-(--r-lg) animate-pulse"
      style={{ height: h, background: "var(--card-2)" }}
    />
  );
}

export function DashboardClient() {
  const { formatCurrency } = useCurrency();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: transactions, isLoading: txnLoading } = useRecentTransactions();
  const { data: accounts, isLoading: acctLoading } = useAccounts();

  const primaryAccount = accounts?.find(a => a.type !== "credit_card");
  const creditCardAccounts = accounts?.filter(a => a.type === "credit_card") ?? [];
  const accountBalance = accounts
    ?.filter((account) => account.type !== "credit_card")
    .reduce((sum, account) => sum + account.balance, 0) ?? 0;

  return (
    <div>
      {/* Balance card — shown immediately, numbers fill in as queries resolve */}
      <div className="mb-5">
        <BalanceCard
          accountBalance={accountBalance}
          income={stats?.income ?? 0}
          expense={stats?.expense ?? 0}
          isLoading={statsLoading || acctLoading}
        />
      </div>

      {/* Desktop two-column layout */}
      <div className="md:grid md:gap-5" style={{ gridTemplateColumns: "1fr 320px" }}>
        {/* Transactions column */}
        <div>
          {/* Upcoming installments — mobile only (desktop has right column) */}
          <div className="md:hidden mb-5">
            <UpcomingPaymentsWidget />
          </div>

          <div className="flex items-center justify-between mb-3 mx-0.5">
            <h2 className="font-extrabold text-[18px] tracking-tight" style={{ color: "var(--ink)" }}>
              Recent Transactions
            </h2>
            <Link href="/transactions" className="font-bold text-sm" style={{ color: "var(--violet)" }}>
              See All
            </Link>
          </div>

          {txnLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map((i) => <SkeletonCard key={i} h={70} />)}
            </div>
          ) : transactions?.length ? (
            <StaggerContainer className="flex flex-col gap-3">
              {transactions.map((t) => (
                <StaggerItem key={t._id}>
                  <TransactionRow transaction={t} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <div
              className="rounded-(--r-md) p-8 text-center font-semibold text-sm"
              style={{ background: "var(--card)", color: "var(--ink-2)" }}
            >
              No transactions yet.{" "}
              <Link href="/transactions/add" style={{ color: "var(--violet)" }}>
                Add one
              </Link>
            </div>
          )}

          {creditCardAccounts.length > 0 && (
            <div className="md:hidden mt-5">
              <CreditCardSummaryWidget />
            </div>
          )}
        </div>

        {/* Desktop right column */}
        <div className="hidden md:flex flex-col gap-5">
          {primaryAccount && <WalletCard account={primaryAccount} />}
          {creditCardAccounts.length > 0 && <CreditCardSummaryWidget />}
          <UpcomingPaymentsWidget />

          {stats && (
            <div
              className="rounded-(--r-lg) p-6"
              style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
            >
              <div className="font-extrabold text-base mb-5" style={{ color: "var(--ink)" }}>
                {new Date().toLocaleString("en-US", { month: "long" })} breakdown
              </div>
              <div className="flex flex-col gap-5">
                <div>
                  <div className="flex justify-between font-bold text-[13.5px] mb-2">
                    <span style={{ color: "var(--ink-2)" }}>Income</span>
                    <span className="tnum">{formatCurrency(stats.income)}</span>
                  </div>
                  <div className="h-2.25 rounded-[6px]" style={{ background: "var(--card-2)" }}>
                    <div className="h-full rounded-[6px]" style={{ width: "100%", background: "var(--violet)" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between font-bold text-[13.5px] mb-2">
                    <span style={{ color: "var(--ink-2)" }}>Spending</span>
                    <span className="tnum">{formatCurrency(stats.expense)}</span>
                  </div>
                  <div className="h-2.25 rounded-[6px]" style={{ background: "var(--card-2)" }}>
                    <div
                      className="h-full rounded-[6px]"
                      style={{
                        width:
                          stats.income > 0
                            ? `${Math.min(100, (stats.expense / stats.income) * 100)}%`
                            : "0%",
                        background: "var(--green)",
                      }}
                    />
                  </div>
                </div>
                <div
                  className="flex items-center justify-between pt-4"
                  style={{ borderTop: "1px solid var(--line)" }}
                >
                  <span className="font-semibold text-[13.5px]" style={{ color: "var(--ink-2)" }}>
                    Net saved
                  </span>
                  <span className="font-extrabold tnum text-[18px]" style={{ color: "var(--green)" }}>
                    +{formatCurrency(Math.max(0, stats.net))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
