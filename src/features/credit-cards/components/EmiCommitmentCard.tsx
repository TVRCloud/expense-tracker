"use client";

import Link from "next/link";
import { useCurrency } from "@/hooks/useCurrency";
import { useRecurringSeriesList } from "@/features/recurring/hooks/useRecurringSeries";

interface Props {
  accountId: string;
}

export function EmiCommitmentCard({ accountId }: Props) {
  const { formatCurrency } = useCurrency();
  const { data } = useRecurringSeriesList(accountId);

  const series = data?.data ?? [];
  if (series.length === 0) return null;

  const totalRemaining = series.reduce((s, sr) => s + sr.amount * sr.remainingCount, 0);
  const totalRemainingInstallments = series.reduce((s, sr) => s + sr.remainingCount, 0);

  if (totalRemainingInstallments === 0) return null;

  return (
    <section>
      <div className="section-head">
        <h2>EMI commitment</h2>
        <span style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
          {totalRemainingInstallments} installment{totalRemainingInstallments !== 1 ? "s" : ""} left
        </span>
      </div>

      <div className="rounded-(--r-lg) p-5 mb-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>Remaining to pay</div>
        <div className="tnum mt-1" style={{ font: "var(--text-stat)", color: "var(--red)" }}>
          {formatCurrency(totalRemaining)}
        </div>
      </div>

      <div className="inset-group">
        {series.map(sr => sr.remainingCount > 0 && (
          <Link
            key={String(sr._id)}
            href={`/transactions/recurring/${String(sr._id)}`}
            className="flex items-center justify-between gap-3 px-4 min-h-[56px] py-2.5 transition-colors active:bg-(--card-2)"
          >
            <div className="min-w-0">
              <div className="text-[15px] font-medium truncate" style={{ color: "var(--ink)" }}>
                {sr.label ?? sr.description ?? sr.category}
              </div>
              <div className="text-xs" style={{ color: "var(--ink-3)" }}>
                {sr.remainingCount} × {formatCurrency(sr.amount)}
              </div>
            </div>
            <div className="tnum flex-none" style={{ font: "var(--text-figure-sm)", color: "var(--ink)" }}>
              {formatCurrency(sr.amount * sr.remainingCount)}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
