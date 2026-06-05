"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { type ITransaction } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  id: string;
}

function formatInputDate(value?: string) {
  if (!value) return format(new Date(), "yyyy-MM-dd");
  return format(new Date(value), "yyyy-MM-dd");
}

export function TransactionDetailClient({ id }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { formatCurrency } = useCurrency();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    description: "",
    category: "",
    subcategory: "",
    note: "",
    tags: "",
    date: format(new Date(), "yyyy-MM-dd"),
  });

  const { data: transaction, isLoading, isError } = useQuery<ITransaction>({
    queryKey: ["transactions", id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ITransaction }>(`/transactions/${id}`);
      return res.data.data;
    },
  });

  useEffect(() => {
    if (!transaction) return;
    setForm({
      description: transaction.description ?? "",
      category: transaction.category ?? "",
      subcategory: transaction.subcategory ?? "",
      note: transaction.note ?? "",
      tags: (transaction.tags ?? []).join(", "),
      date: formatInputDate(transaction.date),
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
        date: form.date,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["transactions", id] });
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
      toast.success("Transaction deleted");
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
        <Skeleton className="h-12 w-32 rounded-[var(--r-sm)]" />
        <Skeleton className="h-44 rounded-[var(--r-lg)]" />
        <Skeleton className="h-64 rounded-[var(--r-lg)]" />
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
        <div className="rounded-[var(--r-lg)] p-8 text-center" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <div className="font-bold" style={{ color: "var(--ink)" }}>Transaction not found</div>
          <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>It may have been deleted or moved.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/transactions" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} />
        Back to transactions
      </Link>

      <section className="rounded-[var(--r-lg)] p-5" style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}>
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
            <button
              onClick={() => setEditing((value) => !value)}
              className="px-4 py-2 rounded-[var(--r-sm)] text-sm font-bold"
              style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this transaction?")) deleteTransaction.mutate();
              }}
              disabled={deleteTransaction.isPending}
              className="w-10 h-10 rounded-[var(--r-sm)] grid place-items-center"
              style={{ background: "rgba(235,87,87,.12)", color: "var(--red)" }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--r-lg)] overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        {editing ? (
          <div className="p-5 flex flex-col gap-4">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Description</span>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Category</span>
                <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Subcategory</span>
                <input value={form.subcategory} onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))} className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Date</span>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Tags</span>
                <input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="comma separated" className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
              </label>
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Note</span>
                <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={4} className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none resize-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
              </label>
            </div>
            <button
              onClick={() => updateTransaction.mutate()}
              disabled={updateTransaction.isPending || !form.category}
              className="inline-flex items-center justify-center gap-2 py-3 rounded-[var(--r-sm)] text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              <Save size={16} />
              {updateTransaction.isPending ? "Saving..." : "Save changes"}
            </button>
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
      </section>
    </div>
  );
}
