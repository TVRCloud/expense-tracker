"use client";

import Link from "next/link";
import { format, isToday, isTomorrow } from "date-fns";
import { RotateCcw } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useUpcomingInstallments } from "../hooks/useRecurringSeries";

function dateLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "d MMM");
}

export function UpcomingPaymentsWidget() {
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useUpcomingInstallments(5);
  const installments = data?.data ?? [];

  if (isLoading) {
    return (
      <div
        className="rounded-(--r-lg) p-5"
        style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="font-extrabold text-base mb-4" style={{ color: "var(--ink)" }}>
          Due Soon
        </div>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-12 rounded-(--r-sm) animate-pulse" style={{ background: "var(--card-2)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (installments.length === 0) return null;

  return (
    <div
      className="rounded-(--r-lg) p-5"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RotateCcw size={15} style={{ color: "var(--violet)" }} />
          <span className="font-extrabold text-base" style={{ color: "var(--ink)" }}>Due Soon</span>
        </div>
        <Link href="/transactions/recurring" className="text-sm font-bold" style={{ color: "var(--violet)" }}>
          View all
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {installments.map(tx => {
          const txDate = new Date(tx.date);
          const label = tx.recurrenceLabel ?? tx.description ?? tx.category;
          const isUrgent = isToday(txDate) || isTomorrow(txDate);
          return (
            <Link
              key={tx._id}
              href={tx.recurringId ? `/transactions/recurring/${tx.recurringId}` : `/transactions/${tx._id}`}
              className="flex items-center gap-3 rounded-(--r-sm) px-3 py-2.5 transition-all hover:opacity-80"
              style={{ background: "var(--card-2)" }}
            >
              <div
                className="w-9 h-9 rounded-(--r-sm) grid place-items-center flex-none text-[10px] font-bold text-center leading-tight"
                style={{
                  background: isUrgent ? "rgba(235,87,87,.12)" : "color-mix(in srgb, var(--violet) 10%, transparent)",
                  color: isUrgent ? "var(--red)" : "var(--violet)",
                }}
              >
                {dateLabel(txDate)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                  {label}
                </div>
                <div className="text-[11px] capitalize" style={{ color: "var(--ink-3)" }}>
                  {tx.category}
                </div>
              </div>
              <div className="font-bold tnum text-[13px] flex-none" style={{ color: isUrgent ? "var(--red)" : "var(--ink-2)" }}>
                {formatCurrency(tx.amount)}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
