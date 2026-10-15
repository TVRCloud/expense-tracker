"use client";

import Link from "next/link";
import { format, isToday, isTomorrow } from "date-fns";
import type { CSSProperties } from "react";
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

  const head = (
    <div className="section-head">
      <h2>Due soon</h2>
      <Link href="/transactions/recurring" className="font-semibold text-sm" style={{ color: "var(--violet)" }}>
        View all
      </Link>
    </div>
  );

  if (isLoading) {
    return (
      <section>
        {head}
        <div className="inset-group">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-14 animate-pulse" style={{ background: "var(--card)" }} />
          ))}
        </div>
      </section>
    );
  }

  if (installments.length === 0) return null;

  return (
    <section>
      {head}
      <div className="inset-group" style={{ "--inset": "68px" } as CSSProperties}>
        {installments.map(tx => {
          const txDate = new Date(tx.date);
          const label = tx.recurrenceLabel ?? tx.description ?? tx.category;
          const isUrgent = isToday(txDate) || isTomorrow(txDate);
          return (
            <Link
              key={tx._id}
              href={tx.recurringId ? `/transactions/recurring/${tx.recurringId}` : `/transactions/${tx._id}`}
              className="flex items-center gap-3 px-4 min-h-[60px] py-2.5 transition-colors active:bg-(--card-2)"
            >
              <div
                className="w-10 h-10 rounded-full grid place-items-center flex-none text-[10px] font-bold text-center leading-tight"
                style={{
                  background: `color-mix(in srgb, ${isUrgent ? "var(--red)" : "var(--violet)"} 12%, transparent)`,
                  color: isUrgent ? "var(--red)" : "var(--ink-2)",
                }}
              >
                {dateLabel(txDate)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium truncate" style={{ color: "var(--ink)" }}>
                  {label}
                </div>
                <div className="text-xs capitalize" style={{ color: "var(--ink-3)" }}>
                  {tx.category}
                </div>
              </div>
              <div className="tnum flex-none" style={{ font: "var(--text-figure-sm)", color: isUrgent ? "var(--red)" : "var(--ink)" }}>
                {formatCurrency(tx.amount)}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
