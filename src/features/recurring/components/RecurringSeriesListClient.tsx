"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { useRecurringSeriesList, type RecurringSeries } from "../hooks/useRecurringSeries";
import { TRANSACTION_CATEGORY_ICONS } from "@/lib/icons";
import { canonicalizeCategory } from "@/lib/category-colors";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import type { CSSProperties } from "react";

function freqLabel(frequency: string, interval: number): string {
  const unit = frequency === "monthly" ? "months" : frequency === "weekly" ? "weeks" : frequency === "daily" ? "days" : "years";
  return interval === 1 ? frequency : `every ${interval} ${unit}`;
}

function SeriesCard({ series }: { series: RecurringSeries }) {
  const { formatCurrency } = useCurrency();
  const CategoryIcon = TRANSACTION_CATEGORY_ICONS[canonicalizeCategory(series.category)] ?? RotateCcw;
  const amountColor = series.type === "income" ? "var(--green)" : "var(--red)";
  const remaining = series.remainingCount;

  return (
    <Link
      href={`/transactions/recurring/${series._id}`}
      className="flex items-center gap-3.5 px-4 min-h-[68px] py-3 transition-colors active:bg-(--card-2)"
    >
      <div
        className="w-11 h-11 rounded-full grid place-items-center flex-none"
        style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
      >
        <CategoryIcon size={19} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[15px] truncate" style={{ color: "var(--ink)" }}>
          {series.label ?? series.description ?? series.category}
        </div>
        <div className="text-xs mt-0.5 capitalize" style={{ color: "var(--ink-3)" }}>
          {freqLabel(series.frequency, series.interval)} · {series.paidCount}/{series.count} paid
          {series.nextDue && ` · next ${format(new Date(series.nextDue), "d MMM")}`}
        </div>
      </div>
      <div className="text-right flex-none">
        <div className="tnum" style={{ font: "var(--text-figure-sm)", fontSize: 15, color: amountColor }}>
          {formatCurrency(series.amount)}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-3)" }}>
          {remaining > 0 ? `${remaining} left` : "Completed"}
        </div>
      </div>
    </Link>
  );
}

export function RecurringSeriesListClient() {
  const { data, isLoading } = useRecurringSeriesList();
  const series = data?.data ?? [];
  const active = series.filter(s => s.remainingCount > 0);
  const done = series.filter(s => s.remainingCount <= 0);

  const group = (items: RecurringSeries[]) => (
    <div className="inset-group" style={{ "--inset": "74px" } as CSSProperties}>
      {items.map(s => <SeriesCard key={s._id} series={s} />)}
    </div>
  );

  return (
    <div className="page-stack">
      <Link href="/transactions" className="inline-flex items-center gap-1.5 text-sm font-semibold min-h-11 self-start" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} /> Transactions
      </Link>

      <PageHeader title="Recurring" subtitle={series.length ? `${active.length} active · ${done.length} completed` : "Installments and repeating payments"} />

      {isLoading ? (
        <div className="inset-group">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-[68px] rounded-none" />)}
        </div>
      ) : series.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-(--r-lg) py-16 text-center px-6"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <RotateCcw size={28} style={{ color: "var(--ink-3)" }} />
          <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>No recurring transactions yet</p>
        </div>
      ) : (
        <div className="grid-2 items-start">
          <section>
            <div className="section-head"><h2>Active</h2></div>
            {active.length ? group(active) : <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Nothing active.</p>}
          </section>
          {done.length > 0 && (
            <section>
              <div className="section-head"><h2>Completed</h2></div>
              {group(done)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
