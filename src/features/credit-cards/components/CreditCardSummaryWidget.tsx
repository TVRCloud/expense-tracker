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
    <div className="min-w-0">
      <div className="truncate mb-0.5" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
        {label}
      </div>
      <div className="tnum truncate" style={{ font: "var(--text-figure-sm)", fontSize: 15, color }}>
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
      <section>
        <div className="section-head"><h2>Credit cards</h2></div>
        <Skeleton className="h-52 rounded-(--r-lg)" />
      </section>
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
    <section>
      <div className="section-head">
        <h2>Credit cards</h2>
        <Link href="/accounts?filter=credit_card" className="font-semibold text-sm" style={{ color: "var(--violet)" }}>
          View all
        </Link>
      </div>

      <div className="rounded-(--r-lg) p-5 grid grid-cols-2 gap-x-4 gap-y-4 mb-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        <MetricTile label="Payable" value={formatCurrency(totalPayable)} tone={totalPayable > 0 ? "red" : "default"} />
        <MetricTile label="Unbilled" value={formatCurrency(totalUnbilled)} tone={totalUnbilled > 0 ? "red" : "default"} />
        <MetricTile label="Exposure" value={formatCurrency(totalExposure)} tone={totalExposure > 0 ? "red" : "default"} />
        <MetricTile label="Available" value={formatCurrency(totalAvailable)} tone={totalAvailable > 0 ? "green" : "red"} />
      </div>

      <div className="inset-group">
        {data.cards.map(card => (
          <Link
            key={card.accountId}
            href={`/accounts/${card.accountId}`}
            className="flex flex-col gap-2 px-4 py-3 transition-colors active:bg-(--card-2)"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <CreditCard size={15} style={{ color: "var(--ink-3)" }} className="flex-none" />
                <span className="text-[15px] font-medium truncate" style={{ color: "var(--ink)" }}>
                  {card.name}
                </span>
                {card.lastFourDigits && (
                  <span className="text-xs" style={{ color: "var(--ink-3)" }}>••{card.lastFourDigits}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-none">
                {card.isOverdue && <AlertTriangle size={13} style={{ color: "var(--red)" }} />}
                {card.nextDueDate && (
                  <span
                    className="text-xs font-semibold"
                    style={{ color: card.isOverdue ? "var(--red)" : card.daysUntilDue !== null && card.daysUntilDue <= 7 ? "var(--amber)" : "var(--ink-3)" }}
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
            <div className="flex justify-between gap-2 text-xs">
              <span style={{ color: "var(--ink-3)" }}>
                Payable{" "}
                <span className="tnum font-semibold" style={{ color: (card.payableStatementDue ?? 0) > 0 ? "var(--red)" : "var(--ink-2)" }}>
                  {formatCurrency(card.payableStatementDue ?? 0)}
                </span>
              </span>
              <span style={{ color: "var(--ink-3)" }}>
                Unbilled{" "}
                <span className="tnum font-semibold" style={{ color: (card.unbilledUsage ?? 0) > 0 ? "var(--red)" : "var(--ink-2)" }}>
                  {formatCurrency(card.unbilledUsage ?? 0)}
                </span>
              </span>
            </div>
            {card.creditLimit > 0 && (
              <CreditUtilizationBar balance={card.balance} creditLimit={card.creditLimit} compact />
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
