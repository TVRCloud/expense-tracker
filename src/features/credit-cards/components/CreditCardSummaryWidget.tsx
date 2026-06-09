"use client";

import Link from "next/link";
import { CreditCard, AlertTriangle } from "lucide-react";
import { useCreditSummary } from "@/features/credit-cards/hooks/useCreditSummary";
import { CreditUtilizationBar } from "./CreditUtilizationBar";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

function MetricTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "red" | "green";
}) {
  const color = tone === "red" ? "var(--red)" : tone === "green" ? "var(--green)" : "var(--ink)";

  return (
    <div className="rounded-(--r-sm) p-3 min-w-0" style={{ background: "var(--card-2)" }}>
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1 truncate" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
      <div className="text-[15px] font-extrabold tnum truncate" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

export function CreditCardSummaryWidget() {
  const { data, isLoading } = useCreditSummary();
  const { formatCurrency } = useCurrency();

  if (isLoading) {
    return (
      <div
        className="rounded-(--r-lg) p-5 flex flex-col gap-4"
        style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton className="h-3 w-12 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-(--r-sm)" />
          ))}
        </div>
        <Skeleton className="h-16 rounded-(--r-sm)" />
      </div>
    );
  }

  if (!data || data.cards.length === 0) return null;

  const totalPayable = data.totalPayableStatementDue ?? data.cards.reduce((sum, card) => sum + (card.payableStatementDue ?? 0), 0);
  const totalUnbilled = data.totalUnbilledUsage ?? data.cards.reduce((sum, card) => sum + (card.unbilledUsage ?? 0), 0);
  const totalExposure = data.totalCreditExposure ?? data.totalDebt;
  const totalAvailable = data.totalAvailableCredit ?? data.cards.reduce(
    (sum, card) => sum + Math.max(0, card.creditLimit - card.balance),
    0
  );

  return (
    <div
      className="rounded-(--r-lg) p-5 flex flex-col gap-4"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard size={16} style={{ color: "var(--violet)" }} />
          <span className="text-sm font-extrabold" style={{ color: "var(--ink)" }}>Credit Cards</span>
        </div>
        <Link href="/accounts?filter=credit_card" className="text-[12px] font-bold" style={{ color: "var(--violet)" }}>
          View all
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Payable" value={formatCurrency(totalPayable)} tone={totalPayable > 0 ? "red" : "default"} />
        <MetricTile label="Unbilled" value={formatCurrency(totalUnbilled)} tone={totalUnbilled > 0 ? "red" : "default"} />
        <MetricTile label="Exposure" value={formatCurrency(totalExposure)} tone={totalExposure > 0 ? "red" : "default"} />
        <MetricTile label="Available" value={formatCurrency(totalAvailable)} tone={totalAvailable > 0 ? "green" : "red"} />
      </div>

      <div className="flex flex-col gap-3">
        {data.cards.map(card => (
          <Link
            key={card.accountId}
            href={`/accounts/${card.accountId}`}
            className="flex flex-col gap-2 rounded-(--r-sm) p-2.5 transition-colors"
            style={{ background: "var(--card-2)" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-bold truncate" style={{ color: "var(--ink)" }}>
                  {card.name}
                </span>
                {card.lastFourDigits && (
                  <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>••{card.lastFourDigits}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-none">
                {card.isOverdue && <AlertTriangle size={13} style={{ color: "var(--red)" }} />}
                {card.nextDueDate && (
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: card.isOverdue ? "var(--red)" : card.daysUntilDue !== null && card.daysUntilDue <= 7 ? "#f59e0b" : "var(--ink-3)" }}
                  >
                    {card.isOverdue
                      ? "Overdue"
                      : card.daysUntilDue !== null && card.daysUntilDue <= 7
                      ? `Due in ${card.daysUntilDue}d`
                      : `Due ${format(new Date(card.nextDueDate), "MMM d")}`}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
              <div className="min-w-0">
                <span style={{ color: "var(--ink-3)" }}>Payable </span>
                <span className="tnum" style={{ color: (card.payableStatementDue ?? 0) > 0 ? "var(--red)" : "var(--ink)" }}>
                  {formatCurrency(card.payableStatementDue ?? 0)}
                </span>
              </div>
              <div className="min-w-0 text-right">
                <span style={{ color: "var(--ink-3)" }}>Unbilled </span>
                <span className="tnum" style={{ color: (card.unbilledUsage ?? 0) > 0 ? "var(--red)" : "var(--ink)" }}>
                  {formatCurrency(card.unbilledUsage ?? 0)}
                </span>
              </div>
            </div>
            {card.creditLimit > 0 && (
              <CreditUtilizationBar
                balance={card.balance}
                creditLimit={card.creditLimit}
                compact
              />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
