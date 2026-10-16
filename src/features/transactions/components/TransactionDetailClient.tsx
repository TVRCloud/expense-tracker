"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Save, Trash2, SplitSquareHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { type ITransaction } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Input } from "@/components/_ui/Input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { ProvenanceCard } from "@/features/reconcile/components/ProvenanceCard";
import { invalidateForResource } from "@/lib/realtime/invalidation";

interface Props {
  id: string;
}

function parseInputDate(value?: string) {
  if (!value) return new Date();
  return new Date(value);
}

export function TransactionDetailClient({ id }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { formatCurrency } = useCurrency();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    description: "",
    category: "",
    subcategory: "",
    note: "",
    tags: "",
    date: new Date(),
  });

  const { data: transaction, isLoading, isError } = useQuery<ITransaction>({
    queryKey: ["transactions", id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ITransaction }>(`/transactions/${id}`);
      return res.data.data;
    },
  });

  const splitGroupId = transaction?.splitGroupId;
  const { data: splitSiblings } = useQuery<ITransaction[]>({
    queryKey: ["transactions", "split", splitGroupId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ITransaction[] }>(`/transactions?splitGroupId=${splitGroupId}`);
      return res.data.data;
    },
    enabled: Boolean(splitGroupId),
  });

  useEffect(() => {
    if (!transaction) return;
    setForm({
      description: transaction.description ?? "",
      category: transaction.category ?? "",
      subcategory: transaction.subcategory ?? "",
      note: transaction.note ?? "",
      tags: (transaction.tags ?? []).join(", "),
      date: parseInputDate(transaction.date),
    });
  }, [transaction]);

  const updateTransaction = useMutation({
    mutationFn: () =>
      apiClient.patch(`/transactions/${id}`, {
        description: form.description || undefined,
        category: form.category || undefined,
        subcategory: form.subcategory || undefined,
        note: form.note || undefined,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        date: form.date.toISOString(),
      }),
    onSuccess: () => {
      invalidateForResource(qc, "transactions");
      void qc.invalidateQueries({ queryKey: ["transactions", id] });
      setEditing(false);
      toast.success("Transaction updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTransaction = useMutation({
    mutationFn: () => apiClient.delete(`/transactions/${id}`),
    onSuccess: () => {
      invalidateForResource(qc, "transactions");
      toast.success("Transaction deleted");
      router.push("/transactions");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteSplitGroup = useMutation({
    mutationFn: async () => {
      const ids = (splitSiblings ?? []).map((s) => String(s._id));
      for (const splitId of ids) {
        await apiClient.delete(`/transactions/${splitId}`);
      }
    },
    onSuccess: () => {
      invalidateForResource(qc, "transactions");
      toast.success("Split purchase deleted");
      router.push("/transactions");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const amountStyle = useMemo(() => {
    if (!transaction) return { color: "var(--ink)" };
    return { color: transaction.type === "income" ? "var(--green)" : "var(--red)" };
  }, [transaction]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-32 rounded-(--r-sm)" />
        <Skeleton className="h-44 rounded-(--r-lg)" />
        <Skeleton className="h-64 rounded-(--r-lg)" />
      </div>
    );
  }

  if (isError || !transaction) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/transactions" className="inline-flex items-center gap-1.5 text-sm font-semibold min-h-11" style={{ color: "var(--violet)" }}>
          <ArrowLeft size={16} />
          Transactions
        </Link>
        <Card radius="lg" className="p-8 text-center">
          <div className="font-bold" style={{ color: "var(--ink)" }}>Transaction not found</div>
          <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>It may have been deleted or moved.</p>
        </Card>
      </div>
    );
  }

  const isSplit = Boolean(splitGroupId && splitSiblings && splitSiblings.length > 1);
  const sign = transaction.type === "income" ? "+" : transaction.type === "transfer" ? "" : "-";
  const details: [string, string][] = [
    ["Description", transaction.description ?? "Not set"],
    ["Date", format(new Date(transaction.date), "d MMM yyyy")],
    ["Account", typeof transaction.account === "string" ? transaction.account : transaction.account.name],
    ["Recurring", transaction.isRecurring ? `${transaction.recurrenceLabel ? `${transaction.recurrenceLabel} · ` : ""}Every ${transaction.recurrenceInterval ?? 1} ${transaction.recurrenceFrequency ?? "period"}${transaction.recurrenceCount ? ` · ${transaction.recurrenceCount} installments` : ""}` : "No"],
    ["Note", transaction.note ?? "Not set"],
    ["Tags", transaction.tags?.length ? transaction.tags.join(", ") : "None"],
  ];

  return (
    <div className="page-stack">
      <Link href="/transactions" className="inline-flex items-center gap-1.5 text-sm font-semibold min-h-11 self-start" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} />
        Transactions
      </Link>

      {/* Hero amount */}
      <Card radius="lg" className="p-6 sm:p-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="capitalize" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
            {transaction.type}
          </div>
          <div
            className="tnum mt-1.5 break-all"
            style={{ font: "var(--text-display)", letterSpacing: "var(--track-title)", ...amountStyle }}
          >
            {sign}
            {formatCurrency(transaction.amount)}
          </div>
          <div className="mt-2 capitalize" style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
            {transaction.category} {transaction.subcategory ? `/ ${transaction.subcategory}` : ""}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditing((value) => !value)}
            className="h-11 px-5 rounded-full"
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          {isSplit && (
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete entire split purchase?",
                  description: `This removes all ${splitSiblings!.length} categories from this purchase and reverses the full amount from your account. This can't be undone.`,
                  confirmLabel: "Delete all",
                  destructive: true,
                });
                if (ok) deleteSplitGroup.mutate();
              }}
              disabled={deleteSplitGroup.isPending}
              className="h-11 px-4 rounded-full text-[13px]"
              style={{ background: "color-mix(in srgb, var(--red) 12%, transparent)", color: "var(--red)" }}
            >
              Delete entire split
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete transaction"
            onClick={async () => {
              const ok = await confirm({
                title: "Delete this transaction?",
                description: "This can't be undone. Account balances will be reversed.",
                confirmLabel: "Delete",
                destructive: true,
              });
              if (ok) deleteTransaction.mutate();
            }}
            disabled={deleteTransaction.isPending}
            className="w-11 h-11 rounded-full"
            style={{ background: "color-mix(in srgb, var(--red) 12%, transparent)", color: "var(--red)" }}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </Card>

      <div className="grid-split">
      <div className="min-w-0">
      <Card radius="lg" className="overflow-hidden">
        {editing ? (
          <div className="p-5 sm:p-6 flex flex-col gap-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label htmlFor="transaction-detail-client-description-1" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Description</Label>
                <Input id="transaction-detail-client-description-1" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transaction-detail-client-category-2" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Category</Label>
                <Input id="transaction-detail-client-category-2" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transaction-detail-client-subcategory-3" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Subcategory</Label>
                <Input id="transaction-detail-client-subcategory-3" value={form.subcategory} onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <DatePickerField
                  label="Date"
                  value={form.date}
                  onChange={(nextDate) => {
                    if (nextDate) setForm((f) => ({ ...f, date: nextDate }));
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transaction-detail-client-tags-4" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Tags</Label>
                <Input id="transaction-detail-client-tags-4" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="comma separated" />
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label htmlFor="transaction-detail-client-note-5" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Note</Label>
                <Textarea id="transaction-detail-client-note-5" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={4} className="resize-none" />
              </div>
            </div>
            <Button
              type="button"
              onClick={() => updateTransaction.mutate()}
              disabled={updateTransaction.isPending || !form.category}
              className="h-11 rounded-full sm:self-end sm:px-8"
            >
              <Save size={16} />
              {updateTransaction.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        ) : (
          <div className="inset-group rounded-none shadow-none">
            {details.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-6 px-5 py-4 min-h-[52px]">
                <span className="text-[15px] flex-none" style={{ color: "var(--ink-2)" }}>{label}</span>
                <span className="text-[15px] font-medium text-right break-words min-w-0" style={{ color: "var(--ink)" }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>

      <aside className="rail flex flex-col gap-5">
      {isSplit && splitSiblings && (
        <section>
          <div className="section-head">
            <h2>Split purchase</h2>
            <span className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink-2)" }}>
              {formatCurrency(splitSiblings.reduce((sum, s) => sum + s.amount, 0))}
            </span>
          </div>
          <div className="inset-group">
            {splitSiblings.map((s) => (
              <Link
                key={s._id}
                href={`/transactions/${s._id}`}
                className="flex items-center justify-between gap-3 px-4 min-h-[52px] py-2.5 transition-colors active:bg-(--card-2)"
                style={{
                  background: String(s._id) === id ? "color-mix(in srgb, var(--violet) 8%, transparent)" : undefined,
                }}
              >
                <span className="flex items-center gap-2 capitalize text-[15px] font-medium" style={{ color: "var(--ink)" }}>
                  <SplitSquareHorizontal size={14} style={{ color: "var(--amber)" }} />
                  {s.category}
                </span>
                <span className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink-2)" }}>{formatCurrency(s.amount)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <ProvenanceCard transactionId={id} />
      </aside>
      </div>
      {dialog}
    </div>
  );
}
