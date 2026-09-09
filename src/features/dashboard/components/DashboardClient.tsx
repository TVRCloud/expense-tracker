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
import { Card } from "@/components/_ui/Card";
import { Progress } from "@/components/_ui/Progress";
import { Skeleton } from "@/components/_ui/Skeleton";

export function DashboardClient() {
  const { formatCurrency } = useCurrency();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: transactions, isLoading: txnLoading } = useRecentTransactions();
  const { data: accounts, isLoading: acctLoading } = useAccounts();

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

      {/* Accounts — every account, not just one, so a wallet with several
          banks/cards is fully visible at a glance instead of guessing. */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3 mx-0.5">
          <h2 className="tracking-tight" style={{ font: "var(--text-h2)", color: "var(--ink)" }}>
            Accounts{accounts?.length ? ` · ${accounts.length}` : ""}
          </h2>
          <Link href="/accounts" className="font-bold text-sm" style={{ color: "var(--violet)" }}>
            See all
          </Link>
        </div>

        {acctLoading ? (
          <div className="flex gap-3 overflow-hidden">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="rounded-(--r-lg) flex-none w-62.5" style={{ height: 164 }} />
            ))}
          </div>
        ) : accounts?.length ? (
          <StaggerContainer
            className="flex gap-3 overflow-x-auto pb-1 -mx-0.5 px-0.5"
            style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none" }}
          >
            {accounts.map((account) => (
              <StaggerItem key={account._id} className="flex-none w-62.5">
                <WalletCard account={account} style={{ scrollSnapAlign: "start" }} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        ) : (
          <Card radius="md" className="p-8 text-center font-semibold text-sm" style={{ color: "var(--ink-2)" }}>
            No accounts yet.{" "}
            <Link href="/accounts" style={{ color: "var(--violet)" }}>
              Add one
            </Link>
          </Card>
        )}
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
            <h2 className="tracking-tight" style={{ font: "var(--text-h2)", color: "var(--ink)" }}>
              Recent transactions
            </h2>
            <Link href="/transactions" className="font-bold text-sm" style={{ color: "var(--violet)" }}>
              See all
            </Link>
          </div>

          {txnLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="rounded-(--r-lg)" style={{ height: 70 }} />
              ))}
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
            <Card radius="md" className="p-8 text-center font-semibold text-sm" style={{ color: "var(--ink-2)" }}>
              No transactions yet.{" "}
              <Link href="/transactions/add" style={{ color: "var(--violet)" }}>
                Add one
              </Link>
            </Card>
          )}

          {creditCardAccounts.length > 0 && (
            <div className="md:hidden mt-5">
              <CreditCardSummaryWidget />
            </div>
          )}
        </div>

        {/* Desktop right column */}
        <div className="hidden md:flex flex-col gap-5">
          {creditCardAccounts.length > 0 && <CreditCardSummaryWidget />}
          <UpcomingPaymentsWidget />

          {stats && (
            <Card radius="lg" className="p-6" style={{ border: "1px solid var(--line)" }}>
              <div className="mb-5" style={{ font: "var(--text-h2)", color: "var(--ink)" }}>
                {new Date().toLocaleString("en-US", { month: "long" })} breakdown
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex justify-between mb-2" style={{ font: "var(--text-label)" }}>
                    <span style={{ color: "var(--ink-2)" }}>Income</span>
                    <span className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink)" }}>
                      {formatCurrency(stats.income)}
                    </span>
                  </div>
                  <Progress value={100} color="var(--violet)" height={3} />
                </div>
                <div>
                  <div className="flex justify-between mb-2" style={{ font: "var(--text-label)" }}>
                    <span style={{ color: "var(--ink-2)" }}>Spending</span>
                    <span className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink)" }}>
                      {formatCurrency(stats.expense)}
                    </span>
                  </div>
                  <Progress
                    value={stats.income > 0 ? (stats.expense / stats.income) * 100 : 0}
                    color="var(--green)"
                    height={3}
                  />
                </div>
                <div
                  className="flex items-center justify-between pt-4"
                  style={{ borderTop: "1px solid var(--line)" }}
                >
                  <span style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
                    Net saved
                  </span>
                  <span className="tnum" style={{ font: "var(--text-stat)", fontSize: 18, color: "var(--green)" }}>
                    +{formatCurrency(Math.max(0, stats.net))}
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
