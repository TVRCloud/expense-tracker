"use client";

import Link from "next/link";
import { CreditCard, AlertTriangle } from "lucide-react";
import { useCreditSummary } from "@/features/credit-cards/hooks/useCreditSummary";
import { CreditUtilizationBar } from "./CreditUtilizationBar";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";

export function CreditCardSummaryWidget() {
  const { data, isLoading } = useCreditSummary();
  const { formatCurrency } = useCurrency();

  if (isLoading || !data || data.cards.length === 0) return null;

  return (
    <div
      className="rounded-[var(--r-lg)] p-5 flex flex-col gap-4"
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

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Total Owed</span>
        <span
          className="text-[22px] font-extrabold tnum"
          style={{ color: data.totalDebt > 0 ? "var(--red)" : "var(--ink)" }}
        >
          {formatCurrency(data.totalDebt)}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {data.cards.map(card => (
          <Link
            key={card.accountId}
            href={`/accounts/${card.accountId}`}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
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
