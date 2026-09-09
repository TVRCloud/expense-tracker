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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/shared/DatePickerField";

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
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["transactions", id] });
      void qc.invalidateQueries({ queryKey: ["credit-summary"] });
      void qc.invalidateQueries({ queryKey: ["credit-statements"] });
      setEditing(false);
      toast.success("Transaction updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTransaction = useMutation({
    mutationFn: () => apiClient.delete(`/transactions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["credit-summary"] });
      void qc.invalidateQueries({ queryKey: ["credit-statements"] });
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
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
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
        <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
          <ArrowLeft size={16} />
          Back to transactions
        </Link>
        <Card radius="lg" className="p-8 text-center">
          <div className="font-bold" style={{ color: "var(--ink)" }}>Transaction not found</div>
          <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>It may have been deleted or moved.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} />
        Back to transactions
      </Link>

      <Card radius="lg" elevation="floating" className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
              {transaction.type}
            </div>
            <div className="text-[34px] font-extrabold tnum mt-1" style={amountStyle}>
              {transaction.type === "income" ? "+" : "-"}
              {formatCurrency(transaction.amount)}
            </div>
            <div className="text-sm font-medium capitalize" style={{ color: "var(--ink-2)" }}>
              {transaction.category} {transaction.subcategory ? `/${transaction.subcategory}` : ""}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing((value) => !value)}
              className="h-auto px-4 py-2 rounded-(--r-sm) font-bold"
            >
              {editing ? "Cancel" : "Edit"}
            </Button>
            {splitGroupId && splitSiblings && splitSiblings.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete entire split purchase?",
                    description: `This removes all ${splitSiblings.length} categories from this purchase and reverses the full amount from your account. This can't be undone.`,
                    confirmLabel: "Delete all",
                    destructive: true,
                  });
                  if (ok) deleteSplitGroup.mutate();
                }}
                disabled={deleteSplitGroup.isPending}
                className="h-auto px-4 py-2 rounded-(--r-sm) font-bold text-sm"
                style={{ background: "rgba(235,87,87,.12)", color: "var(--red)" }}
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
              className="w-10 h-10 rounded-(--r-sm)"
              style={{ background: "rgba(235,87,87,.12)", color: "var(--red)" }}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
      </Card>

      {splitGroupId && splitSiblings && splitSiblings.length > 1 && (
        <Card radius="lg" className="p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <SplitSquareHorizontal size={15} style={{ color: "var(--amber)" }} />
            <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>
              Split purchase — {splitSiblings.length} categories, total {formatCurrency(splitSiblings.reduce((sum, s) => sum + s.amount, 0))}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {splitSiblings.map((s) => (
              <Link
                key={s._id}
                href={`/transactions/${s._id}`}
                className="flex items-center justify-between px-3 py-2 rounded-(--r-sm) text-sm"
                style={{
                  background: String(s._id) === id ? "color-mix(in srgb, var(--violet) 10%, transparent)" : "var(--card-2)",
                }}
              >
                <span className="font-semibold capitalize" style={{ color: "var(--ink)" }}>{s.category}</span>
                <span className="tnum font-bold" style={{ color: "var(--ink-2)" }}>{formatCurrency(s.amount)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card radius="lg" className="overflow-hidden">
        {editing ? (
          <div className="p-5 flex flex-col gap-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Description</Label>
                <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Category</Label>
                <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Subcategory</Label>
                <Input value={form.subcategory} onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))} />
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
                <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Tags</Label>
                <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="comma separated" />
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Note</Label>
                <Textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={4} className="resize-none" />
              </div>
            </div>
            <Button
              type="button"
              onClick={() => updateTransaction.mutate()}
              disabled={updateTransaction.isPending || !form.category}
              className="h-auto py-3 rounded-(--r-sm) font-bold"
            >
              <Save size={16} />
              {updateTransaction.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--line)" }}>
            {[
              ["Description", transaction.description ?? "Not set"],
              ["Date", format(new Date(transaction.date), "d MMM yyyy")],
              ["Account", typeof transaction.account === "string" ? transaction.account : transaction.account.name],
              ["Recurring", transaction.isRecurring ? `${transaction.recurrenceLabel ? `${transaction.recurrenceLabel} · ` : ""}Every ${transaction.recurrenceInterval ?? 1} ${transaction.recurrenceFrequency ?? "period"}${transaction.recurrenceCount ? ` · ${transaction.recurrenceCount} installments` : ""}` : "No"],
              ["Note", transaction.note ?? "Not set"],
              ["Tags", transaction.tags?.length ? transaction.tags.join(", ") : "None"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-5 py-4">
                <span className="text-sm font-semibold" style={{ color: "var(--ink-3)" }}>{label}</span>
                <span className="text-sm font-bold text-right break-all" style={{ color: "var(--ink)" }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {dialog}
    </div>
  );
}
