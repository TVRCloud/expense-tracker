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
import { Progress } from "@/components/_ui/Progress";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Button } from "@/components/_ui/Button";
import { Receipt, Wallet } from "lucide-react";
import type { ReactNode } from "react";

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

  return (
    <div>
      {/* Balance card — shown immediately, numbers fill in as queries resolve */}
      <div className="mb-5">
        <BalanceCard
          accountBalance={accountBalance}
          income={stats?.income ?? 0}
          expense={stats?.expense ?? 0}
          isLoading={statsLoading || acctLoading}
          cardLastFour={primaryAccount?.creditMeta?.lastFourDigits}
        />
      </div>

      {/* Accounts — every account, not just one, so a wallet with several
          banks/cards is fully visible at a glance instead of guessing. */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3 mx-0.5">
          <h2 className="tracking-tight" style={{ font: "var(--text-h2)", color: "var(--ink)" }}>
            Accounts{accounts?.length ? ` · ${accounts.length}` : ""}
          </h2>
          <Link href="/accounts" className="font-semibold text-sm" style={{ color: "var(--violet)" }}>
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
          <EmptyCard
            icon={<Wallet size={22} />}
            title="No accounts yet"
            body="Add a bank account, card or cash wallet to start tracking."
            href="/accounts"
            action="Add an account"
          />
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
            <Link href="/transactions" className="font-semibold text-sm" style={{ color: "var(--violet)" }}>
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
            <EmptyCard
              icon={<Receipt size={22} />}
              title="No transactions yet"
              body="Add one, or connect the phone app to capture bank SMS automatically."
              href="/transactions/add"
              action="Add a transaction"
            />
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
                {/* Both bars on one scale, so their lengths compare. */}
                <div>
                  <div className="flex justify-between mb-2" style={{ font: "var(--text-label)" }}>
                    <span style={{ color: "var(--ink-2)" }}>Income</span>
                    <span className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink)" }}>
                      {formatCurrency(stats.income)}
                    </span>
                  </div>
                  <Progress value={barScale ? (stats.income / barScale) * 100 : 0} color="var(--green)" height={3} />
                </div>
                <div>
                  <div className="flex justify-between mb-2" style={{ font: "var(--text-label)" }}>
                    <span style={{ color: "var(--ink-2)" }}>Spending</span>
                    <span className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink)" }}>
                      {formatCurrency(stats.expense)}
                    </span>
                  </div>
                  <Progress value={barScale ? (stats.expense / barScale) * 100 : 0} color="var(--red)" height={3} />
                </div>
                <div
                  className="flex items-center justify-between pt-4"
                  style={{ borderTop: "1px solid var(--line)" }}
                >
                  <span style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
                    {stats.net >= 0 ? "Net saved" : "Overspent"}
                  </span>
                  <span
                    className="tnum"
                    style={{ font: "var(--text-stat)", fontSize: 18, color: stats.net >= 0 ? "var(--green)" : "var(--red)" }}
                  >
                    {stats.net >= 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(stats.net))}
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
