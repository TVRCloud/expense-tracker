"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useRecurringSeriesDetail,
  useMarkInstallment,
  useCancelSeries,
} from "../hooks/useRecurringSeries";
import { Skeleton } from "@/components/ui/skeleton";
import { type ITransaction } from "@/types/models";

const FREQ_LABEL: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  yearly: "yearly",
};

function freqLabel(frequency: string, interval: number): string {
  if (interval === 1) return FREQ_LABEL[frequency] ?? frequency;
  return `every ${interval} ${frequency === "monthly" ? "months" : frequency === "weekly" ? "weeks" : frequency === "daily" ? "days" : "years"}`;
}

function statusChip(status: string) {
  const cfg = {
    paid: { bg: "rgba(79,192,126,.15)", color: "var(--green)", label: "Paid" },
    upcoming: { bg: "color-mix(in srgb, var(--violet) 12%, transparent)", color: "var(--violet)", label: "Upcoming" },
    overdue: { bg: "rgba(235,87,87,.12)", color: "var(--red)", label: "Overdue" },
    skipped: { bg: "var(--card-2)", color: "var(--ink-3)", label: "Skipped" },
  }[status] ?? { bg: "var(--card-2)", color: "var(--ink-3)", label: status };

  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

interface Props {
  recurringId: string;
}

export function RecurringSeriesClient({ recurringId }: Props) {
  const router = useRouter();
  const { formatCurrency } = useCurrency();
  const { data, isLoading, isError } = useRecurringSeriesDetail(recurringId);
  const markInstallment = useMarkInstallment(recurringId);
  const cancelSeries = useCancelSeries(recurringId);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-28 rounded-(--r-sm)" />
        <Skeleton className="h-36 rounded-(--r-lg)" />
        <Skeleton className="h-64 rounded-(--r-lg)" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
          <ArrowLeft size={16} /> Back to Transactions
        </Link>
        <div className="rounded-(--r-lg) p-8 text-center" style={{ background: "var(--card)" }}>
          <div className="font-bold" style={{ color: "var(--ink)" }}>Series not found</div>
        </div>
      </div>
    );
  }

  const { series, data: installments } = data;
  const amountColor = series.type === "income" ? "var(--green)" : "var(--red)";
  const paidAmount = installments
    .filter(t => t.installmentStatus === "paid")
    .reduce((s, t) => s + t.amount, 0);
  const progressPct = series.count > 0 ? (series.paidCount / series.count) * 100 : 0;
  const remainingCount = series.count - series.paidCount;

  function handleMarkPaid(tx: ITransaction) {
    markInstallment.mutate(
      { id: tx._id, status: "paid" },
      { onSuccess: () => toast.success("Marked as paid"), onError: () => toast.error("Failed to update") }
    );
  }

  function handleMarkUnpaid(tx: ITransaction) {
    markInstallment.mutate(
      { id: tx._id, status: "upcoming" },
      { onSuccess: () => toast.success("Marked as upcoming"), onError: () => toast.error("Failed to update") }
    );
  }

  function handleCancel() {
    cancelSeries.mutate(undefined, {
      onSuccess: () => {
        toast.success("Remaining installments cancelled");
        router.push("/transactions");
      },
      onError: () => toast.error("Failed to cancel series"),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} /> Back to Transactions
      </Link>

      {/* Series header */}
      <div className="rounded-(--r-lg) p-5 flex flex-col gap-4" style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}>
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-full grid place-items-center flex-none"
            style={{ background: "color-mix(in srgb, var(--violet) 12%, transparent)", color: "var(--violet)" }}
          >
            <RotateCcw size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-[17px] truncate" style={{ color: "var(--ink)" }}>
              {series.label ?? series.description ?? series.category}
            </div>
            <div className="text-xs font-medium mt-0.5 capitalize" style={{ color: "var(--ink-3)" }}>
              {freqLabel(series.frequency, series.interval)} · {series.category}
            </div>
          </div>
          <div className="text-right flex-none">
            <div className="text-[13px] font-bold tnum" style={{ color: amountColor }}>
              {formatCurrency(series.amount)}<span className="font-normal text-[11px]"> /installment</span>
            </div>
            <div className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--ink-3)" }}>
              {formatCurrency(series.total)} total
            </div>
          </div>
        </div>

        {/* Progress row */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
            <span>{series.paidCount} of {series.count} paid · {formatCurrency(paidAmount)}</span>
            <span style={{ color: "var(--ink-3)" }}>{formatCurrency(series.remainingAmount)} remaining</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progressPct}%`, background: "var(--green)" }}
            />
          </div>
          <div className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
            {remainingCount > 0 ? `${remainingCount} installment${remainingCount !== 1 ? "s" : ""} remaining` : "All installments paid"}
          </div>
        </div>
      </div>

      {/* Installment list */}
      <div className="rounded-(--r-lg) overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--line)" }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Installments
          </div>
        </div>
        <div className="flex flex-col divide-y" style={{ "--divide-color": "var(--line)" } as React.CSSProperties}>
          {installments.map((tx) => (
            <div key={tx._id} className="flex items-center gap-3 px-5 py-3.5">
              {/* Date + index */}
              <div className="flex-none text-center w-10">
                <div className="text-[10px] font-bold uppercase" style={{ color: "var(--ink-3)" }}>
                  {format(new Date(tx.date), "MMM")}
                </div>
                <div className="text-[17px] font-extrabold leading-none" style={{ color: "var(--ink)" }}>
                  {format(new Date(tx.date), "d")}
                </div>
              </div>

              {/* Status + label */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {statusChip(tx.installmentStatus ?? "upcoming")}
                  <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
                    #{(tx.installmentIndex ?? 0) + 1}
                  </span>
                </div>
                {tx.paidAt && (
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--ink-3)" }}>
                    Paid {format(new Date(tx.paidAt), "d MMM yyyy")}
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="font-extrabold tnum text-[14px] flex-none" style={{ color: amountColor }}>
                {formatCurrency(tx.amount)}
              </div>

              {/* Action */}
              <div className="flex-none">
                {tx.installmentStatus === "paid" ? (
                  <button
                    onClick={() => handleMarkUnpaid(tx)}
                    disabled={markInstallment.isPending}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-(--r-sm) disabled:opacity-40"
                    style={{ background: "var(--card-2)", color: "var(--ink-3)" }}
                  >
                    Undo
                  </button>
                ) : tx.installmentStatus !== "skipped" ? (
                  <button
                    onClick={() => handleMarkPaid(tx)}
                    disabled={markInstallment.isPending}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-(--r-sm) disabled:opacity-40"
                    style={{ background: "color-mix(in srgb, var(--green) 12%, transparent)", color: "var(--green)" }}
                  >
                    Mark Paid
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cancel series */}
      {remainingCount > 0 && (
        <div className="flex justify-end">
          {confirmCancel ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>Cancel {remainingCount} remaining?</span>
              <button
                onClick={() => setConfirmCancel(false)}
                className="px-3 py-1.5 rounded-(--r-sm) text-sm font-bold"
                style={{ background: "var(--card)", color: "var(--ink-3)" }}
              >
                No
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelSeries.isPending}
                className="px-3 py-1.5 rounded-(--r-sm) text-sm font-bold disabled:opacity-50"
                style={{ background: "rgba(235,87,87,.12)", color: "var(--red)" }}
              >
                {cancelSeries.isPending ? "Cancelling..." : "Yes, Cancel"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-(--r-sm) text-sm font-bold"
              style={{ background: "rgba(235,87,87,.08)", color: "var(--red)" }}
            >
              <Trash2 size={14} />
              Cancel remaining installments
            </button>
          )}
        </div>
      )}
    </div>
  );
}
