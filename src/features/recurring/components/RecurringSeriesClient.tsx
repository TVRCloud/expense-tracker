"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useRecurringSeriesDetail,
  useMarkInstallment,
  useCancelSeries,
} from "../hooks/useRecurringSeries";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Progress } from "@/components/_ui/Progress";
import { PageHeader } from "@/components/shared/PageHeader";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
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
    paid: { bg: "color-mix(in srgb, var(--green) 14%, transparent)", color: "var(--green)", label: "Paid" },
    upcoming: { bg: "color-mix(in srgb, var(--violet) 12%, transparent)", color: "var(--violet)", label: "Upcoming" },
    overdue: { bg: "color-mix(in srgb, var(--red) 12%, transparent)", color: "var(--red)", label: "Overdue" },
    skipped: { bg: "var(--card-2)", color: "var(--ink-3)", label: "Skipped" },
  }[status] ?? { bg: "var(--card-2)", color: "var(--ink-3)", label: status };

  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
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
  const { confirm, dialog } = useConfirm();

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
        <Card radius="lg" className="p-8 text-center">
          <div className="font-bold" style={{ color: "var(--ink)" }}>Series not found</div>
        </Card>
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

  async function handleCancel() {
    const ok = await confirm({
      title: `Cancel ${remainingCount} remaining installment${remainingCount !== 1 ? "s" : ""}?`,
      description: "Already-paid installments stay as-is. This can't be undone.",
      confirmLabel: "Cancel installments",
      destructive: true,
    });
    if (!ok) return;
    cancelSeries.mutate(undefined, {
      onSuccess: () => {
        toast.success("Remaining installments cancelled");
        router.push("/transactions");
      },
      onError: () => toast.error("Failed to cancel series"),
    });
  }

  const title = series.label ?? series.description ?? series.category;

  return (
    <div className="page-stack">
      <Link href="/transactions/recurring" className="inline-flex items-center gap-1.5 text-sm font-semibold min-h-11 self-start" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} /> Recurring
      </Link>

      <PageHeader
        title={title}
        subtitle={<span className="capitalize">{freqLabel(series.frequency, series.interval)} · {series.category}</span>}
        actions={
          remainingCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              disabled={cancelSeries.isPending}
              className="h-10 inline-flex items-center gap-2 px-4 rounded-full text-[13px]"
              style={{ background: "color-mix(in srgb, var(--red) 8%, transparent)", color: "var(--red)" }}
            >
              <Trash2 size={14} />
              {cancelSeries.isPending ? "Cancelling..." : "Cancel remaining"}
            </Button>
          ) : undefined
        }
      />

      <div className="grid-split">
        {/* Installments */}
        <section className="min-w-0 order-2 lg:order-1">
          <div className="section-head"><h2>Installments</h2></div>
          <div className="inset-group" style={{ "--inset": "76px" } as React.CSSProperties}>
            {installments.map((tx) => (
              <div key={tx._id} className="flex items-center gap-3 px-4 min-h-[64px] py-2.5">
                <div className="flex-none text-center w-11">
                  <div style={{ font: "var(--text-micro)", color: "var(--ink-3)" }} className="uppercase">
                    {format(new Date(tx.date), "MMM")}
                  </div>
                  <div className="tnum leading-none mt-0.5" style={{ font: "var(--text-stat)", fontSize: 18, color: "var(--ink)" }}>
                    {format(new Date(tx.date), "d")}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusChip(tx.installmentStatus ?? "upcoming")}
                    <span className="text-xs" style={{ color: "var(--ink-3)" }}>
                      #{(tx.installmentIndex ?? 0) + 1}
                    </span>
                  </div>
                  {tx.paidAt && (
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-3)" }}>
                      Paid {format(new Date(tx.paidAt), "d MMM yyyy")}
                    </div>
                  )}
                </div>

                <div className="tnum flex-none" style={{ font: "var(--text-figure-sm)", color: amountColor }}>
                  {formatCurrency(tx.amount)}
                </div>

                <div className="flex-none">
                  {tx.installmentStatus === "paid" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleMarkUnpaid(tx)}
                      disabled={markInstallment.isPending}
                      className="h-9 text-[13px] px-3.5 rounded-full"
                      style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
                    >
                      Undo
                    </Button>
                  ) : tx.installmentStatus !== "skipped" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleMarkPaid(tx)}
                      disabled={markInstallment.isPending}
                      className="h-9 text-[13px] px-3.5 rounded-full"
                      style={{ background: "color-mix(in srgb, var(--green) 12%, transparent)", color: "var(--green)" }}
                    >
                      Mark paid
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Summary rail */}
        <aside className="rail order-1 lg:order-2">
          <Card radius="lg" className="p-6 flex flex-col gap-5">
            <div>
              <div style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>Per installment</div>
              <div className="tnum mt-1" style={{ font: "var(--text-stat)", color: amountColor }}>
                {formatCurrency(series.amount)}
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{formatCurrency(series.total)} total</div>
            </div>
            <div className="flex flex-col gap-2">
              <Progress value={progressPct} color="var(--green)" trackColor="var(--line)" height={4} aria-label="Installments paid" />
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--ink-2)" }}>
                <span>{series.paidCount} of {series.count} paid · {formatCurrency(paidAmount)}</span>
                <span style={{ color: "var(--ink-3)" }}>{formatCurrency(series.remainingAmount)} left</span>
              </div>
              <div className="text-xs" style={{ color: "var(--ink-3)" }}>
                {remainingCount > 0 ? `${remainingCount} installment${remainingCount !== 1 ? "s" : ""} remaining` : "All installments paid"}
              </div>
            </div>
          </Card>
        </aside>
      </div>
      {dialog}
    </div>
  );
}
