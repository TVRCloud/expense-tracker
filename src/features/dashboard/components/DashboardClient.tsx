"use client";

import Link from "next/link";
import { useDashboardStats, useRecentTransactions, useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { type IAccount } from "@/types/models";
import { BalanceCard } from "./SpendCard";
import { WalletCard } from "./WalletCard";
import { CreditCardSummaryWidget } from "@/features/credit-cards/components/CreditCardSummaryWidget";
import { UpcomingPaymentsWidget } from "@/features/recurring/components/UpcomingPaymentsWidget";
import { TransactionRow } from "@/features/transactions/components/TransactionRow";
import { useCurrency } from "@/hooks/useCurrency";
import { StaggerContainer, StaggerItem } from "@/components/shared/StaggerContainer";
import { Card } from "@/components/_ui/Card";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Button } from "@/components/_ui/Button";
import { Receipt, Wallet, Plus, TrendingUp, TrendingDown, PiggyBank } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "./StatCard";
import type { CSSProperties, ReactNode } from "react";

export function DashboardClient() {
  const { formatCurrency } = useCurrency();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: transactions, isLoading: txnLoading } = useRecentTransactions();
  const { data: accounts, isLoading: acctLoading } = useAccounts();

  const creditCardAccounts = accounts?.filter(a => a.type === "credit_card") ?? [];
  const accountBalance = accounts
    ?.filter((account) => account.type !== "credit_card")
    .reduce((sum, account) => sum + account.balance, 0) ?? 0;
  const barScale = stats ? Math.max(stats.income, stats.expense) : 0;
  const primaryAccount = accounts?.[0] as (IAccount & { creditMeta?: { lastFourDigits?: string } }) | undefined;

  const net = stats?.net ?? 0;
  const monthName = new Date().toLocaleString("en-US", { month: "long" });
  const statsPending = statsLoading && !stats;

  return (
    <div className="page-stack">
      <PageHeader
        title="Home"
        subtitle={`${monthName} overview`}
        actions={
          <Button asChild className="btn-interactive hidden md:inline-flex h-10 rounded-full px-5 text-[13px]">
            <Link href="/transactions/add">
              <Plus size={16} />
              Add transaction
            </Link>
          </Button>
        }
      />

      {/* Hero — shown immediately, numbers fill in as queries resolve */}
      <BalanceCard
        accountBalance={accountBalance}
        income={stats?.income ?? 0}
        expense={stats?.expense ?? 0}
        isLoading={statsLoading || acctLoading}
        cardLastFour={primaryAccount?.creditMeta?.lastFourDigits}
      />

      {/* Stat strip — bars share one scale so lengths compare */}
      <div className="grid-cards" style={{ "--card-min": "220px" } as CSSProperties}>
        <StatCard
          icon={<TrendingUp size={14} />}
          label="Income"
          value={formatCurrency(stats?.income ?? 0)}
          color="var(--green)"
          progress={barScale ? ((stats?.income ?? 0) / barScale) * 100 : 0}
          caption={`${monthName} so far`}
          loading={statsPending}
        />
        <StatCard
          icon={<TrendingDown size={14} />}
          label="Spending"
          value={formatCurrency(stats?.expense ?? 0)}
          color="var(--red)"
          progress={barScale ? ((stats?.expense ?? 0) / barScale) * 100 : 0}
          caption={`${monthName} so far`}
          loading={statsPending}
        />
        <StatCard
          icon={<PiggyBank size={14} />}
          label={net >= 0 ? "Net saved" : "Overspent"}
          value={`${net >= 0 ? "+" : "−"}${formatCurrency(Math.abs(net))}`}
          color={net >= 0 ? "var(--green)" : "var(--red)"}
          caption={net >= 0 ? "Income minus spending" : "Spending is ahead of income"}
          loading={statsPending}
        />
      </div>

      {/* Accounts — swipe row on phones, responsive grid from sm up */}
      <section>
        <div className="section-head">
          <h2>Accounts{accounts?.length ? ` · ${accounts.length}` : ""}</h2>
          <Link href="/accounts" className="font-semibold text-sm" style={{ color: "var(--violet)" }}>
            See all
          </Link>
        </div>

        {acctLoading ? (
          <div className="flex gap-3 overflow-hidden sm:grid sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="rounded-(--r-lg) flex-none w-62.5 sm:w-auto" style={{ height: 148 }} />
            ))}
          </div>
        ) : accounts?.length ? (
          <StaggerContainer
            className="flex gap-3 overflow-x-auto pb-1 -mx-(--gutter) px-(--gutter) sm:mx-0 sm:px-0 sm:pb-0 sm:overflow-visible sm:grid sm:gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))]"
            style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none" }}
          >
            {accounts.map((account) => (
              <StaggerItem key={account._id} className="flex-none w-62.5 sm:w-auto" style={{ scrollSnapAlign: "start" }}>
                <WalletCard account={account} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        ) : (
          <EmptyCard
            icon={<Wallet size={22} />}
            title="No accounts yet"
            body="Add a bank account, card or cash wallet to start tracking."
            href="/accounts"
            action="Add an account"
          />
        )}
      </section>

      {/* Recent transactions + side rail */}
      <div className="grid-split">
        <section className="min-w-0">
          <div className="section-head">
            <h2>Recent transactions</h2>
            <Link href="/transactions" className="font-semibold text-sm" style={{ color: "var(--violet)" }}>
              See all
            </Link>
          </div>

          {txnLoading ? (
            <div className="inset-group" style={{ "--inset": "72px" } as CSSProperties}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3.5 px-4 min-h-[60px]">
                  <Skeleton className="w-11 h-11 rounded-full flex-none" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-1/3 rounded-full" />
                    <Skeleton className="h-3 w-1/5 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : transactions?.length ? (
            <StaggerContainer className="inset-group" style={{ "--inset": "72px" } as CSSProperties}>
              {transactions.map((t) => (
                <StaggerItem key={t._id}>
                  <TransactionRow transaction={t} grouped />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <EmptyCard
              icon={<Receipt size={22} />}
              title="No transactions yet"
              body="Add one, or connect the phone app to capture bank SMS automatically."
              href="/transactions/add"
              action="Add a transaction"
            />
          )}
        </section>

        <aside className="rail flex flex-col gap-5">
          <UpcomingPaymentsWidget />
          {creditCardAccounts.length > 0 && <CreditCardSummaryWidget />}
        </aside>
      </div>
    </div>
  );
}

/** Empty state: what's missing, why it matters, one clear next step. */
function EmptyCard({ icon, title, body, href, action }: { icon: ReactNode; title: string; body: string; href: string; action: string }) {
  return (
    <Card radius="md" className="p-8 flex flex-col items-center text-center gap-2">
      <div className="w-12 h-12 rounded-full grid place-items-center mb-1" style={{ background: "var(--card-2)", color: "var(--ink-2)" }} aria-hidden>
        {icon}
      </div>
      <div className="font-semibold" style={{ color: "var(--ink)" }}>{title}</div>
      <p className="text-sm max-w-xs" style={{ color: "var(--ink-2)" }}>{body}</p>
      <Button asChild className="mt-2">
        <Link href={href}>{action}</Link>
      </Button>
    </Card>
  );
}
