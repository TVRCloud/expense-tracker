"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { useRecurringSeriesList, type RecurringSeries } from "../hooks/useRecurringSeries";
import { TRANSACTION_CATEGORY_ICONS } from "@/lib/icons";
import { Skeleton } from "@/components/ui/skeleton";

function freqLabel(frequency: string, interval: number): string {
  const unit = frequency === "monthly" ? "months" : frequency === "weekly" ? "weeks" : frequency === "daily" ? "days" : "years";
  return interval === 1 ? frequency : `every ${interval} ${unit}`;
}

function SeriesCard({ series }: { series: RecurringSeries }) {
  const { formatCurrency } = useCurrency();
  const CategoryIcon = TRANSACTION_CATEGORY_ICONS[series.category] ?? RotateCcw;
  const amountColor = series.type === "income" ? "var(--green)" : "var(--red)";
  const remaining = series.remainingCount;

  return (
    <Link
      href={`/transactions/recurring/${series._id}`}
      className="flex items-center gap-4 rounded-[var(--r-md)] px-4 py-4"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="w-11 h-11 rounded-full grid place-items-center flex-none"
        style={{ background: "color-mix(in srgb, var(--violet) 12%, transparent)", color: "var(--violet)" }}
      >
        <CategoryIcon size={19} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm truncate" style={{ color: "var(--ink)" }}>
          {series.label ?? series.description ?? series.category}
        </div>
        <div className="text-xs font-medium mt-0.5 capitalize" style={{ color: "var(--ink-3)" }}>
          {freqLabel(series.frequency, series.interval)} · {series.paidCount}/{series.count} paid
          {series.nextDue && ` · next ${format(new Date(series.nextDue), "d MMM")}`}
        </div>
      </div>
      <div className="text-right flex-none">
        <div className="font-extrabold tnum text-[15px]" style={{ color: amountColor }}>
          {formatCurrency(series.amount)}
        </div>
        <div className="text-[11px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
          {remaining > 0 ? `${remaining} left` : "Completed"}
        </div>
      </div>
    </Link>
  );
}

export function RecurringSeriesListClient() {
  const { data, isLoading } = useRecurringSeriesList();
  const series = data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} /> Back to Transactions
      </Link>

      <div className="flex items-center gap-2">
        <RotateCcw size={18} style={{ color: "var(--violet)" }} />
        <h1 className="text-lg font-extrabold" style={{ color: "var(--ink)" }}>Recurring</h1>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 rounded-[var(--r-md)]" />)}
        </div>
      ) : series.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] py-16"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <RotateCcw size={28} style={{ color: "var(--ink-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No recurring transactions yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {series.map(s => <SeriesCard key={s._id} series={s} />)}
        </div>
      )}
    </div>
  );
}
