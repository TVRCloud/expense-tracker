"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
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
    <div
      className="rounded-(--r-lg) p-4 flex flex-col gap-3"
      style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RotateCcw size={14} style={{ color: "var(--violet)" }} />
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            EMI Commitment
          </span>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: "var(--ink-3)" }}>
          {totalRemainingInstallments} installment{totalRemainingInstallments !== 1 ? "s" : ""} remaining
        </span>
      </div>

      <div className="text-[22px] font-extrabold tnum" style={{ color: "var(--red)" }}>
        {formatCurrency(totalRemaining)}
      </div>

      <div className="flex flex-col gap-2">
        {series.map(sr => sr.remainingCount > 0 && (
          <Link
            key={String(sr._id)}
            href={`/transactions/recurring/${String(sr._id)}`}
            className="flex items-center justify-between rounded-(--r-sm) px-3 py-2 transition-all hover:opacity-80"
            style={{ background: "var(--card-2)" }}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                {sr.label ?? sr.description ?? sr.category}
              </div>
              {sr.description && sr.description !== sr.label && (
                <div className="text-[11px] truncate" style={{ color: "var(--ink-3)" }}>
                  {sr.description}
                </div>
              )}
              <div className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                {sr.remainingCount} × {formatCurrency(sr.amount)}
              </div>
            </div>
            <div className="text-[13px] font-bold tnum flex-none ml-3" style={{ color: "var(--ink-2)" }}>
              {formatCurrency(sr.amount * sr.remainingCount)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
