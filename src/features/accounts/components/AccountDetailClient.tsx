"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Archive, Save, CreditCard } from "lucide-react";
import { ACCOUNT_TYPE_ICONS } from "@/lib/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { useTransactions } from "@/features/transactions/hooks/useTransactions";
import { TransactionRow } from "@/features/transactions/components/TransactionRow";
import { CreditCardDetailClient } from "@/features/credit-cards/components/CreditCardDetailClient";
import { type IAccount } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  id: string;
}

export function AccountDetailClient({ id }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { formatCurrency } = useCurrency();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", color: "" });

  const { data: account, isLoading, isError } = useQuery<IAccount>({
    queryKey: ["accounts", id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: IAccount }>(`/accounts/${id}`);
      return res.data.data;
    },
  });

  const { data: transactions, isLoading: txLoading } = useTransactions({ accountId: id, limit: 10, includeUnpaidRecurring: true });

  useEffect(() => {
    if (!account) return;
    setForm({
      name: account.name ?? "",
      color: account.color ?? "",
    });
  }, [account]);

  const updateAccount = useMutation({
    mutationFn: () =>
      apiClient.patch(`/accounts/${id}`, {
        name: form.name,
        color: form.color || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["accounts", id] });
      setEditing(false);
      toast.success("Account updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveAccount = useMutation({
    mutationFn: () => apiClient.delete(`/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account archived");
      router.push("/accounts");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-28 rounded-(--r-sm)" />
        <Skeleton className="h-48 rounded-(--r-lg)" />
        <Skeleton className="h-72 rounded-(--r-lg)" />
      </div>
    );
  }

  if (isError || !account) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/accounts" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
          <ArrowLeft size={16} />
          Back to accounts
        </Link>
        <div className="rounded-(--r-lg) p-8 text-center" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <div className="font-bold" style={{ color: "var(--ink)" }}>Account not found</div>
          <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>It may have been archived or deleted.</p>
        </div>
      </div>
    );
  }

  // Delegate credit cards to specialised view
  if (account.type === "credit_card") {
    return <CreditCardDetailClient id={id} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/accounts" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} />
        Back to accounts
      </Link>

      <section className="rounded-(--r-lg) p-5" style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}>
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center flex-none"
            style={{ background: account.color || "var(--card-2)", color: account.color ? "#fff" : "var(--violet)" }}
          >
            {(() => {
              const TypeIcon = ACCOUNT_TYPE_ICONS[account.type] ?? CreditCard;
              return <TypeIcon size={26} />;
            })()}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
              {account.type.replace("_", " ")} · {account.currency}
            </div>
            <h2 className="text-2xl font-extrabold truncate" style={{ color: "var(--ink)" }}>{account.name}</h2>
            <div className="text-[34px] font-extrabold tnum mt-2" style={{ color: account.balance >= 0 ? "var(--ink)" : "var(--red)" }}>
              {formatCurrency(account.balance)}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setEditing((value) => !value)}
              className="px-4 py-2 rounded-(--r-sm) text-sm font-bold"
              style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button
              onClick={() => {
                if (confirm(`Archive "${account.name}"?`)) archiveAccount.mutate();
              }}
              disabled={archiveAccount.isPending}
              className="w-10 h-10 rounded-(--r-sm) grid place-items-center"
              style={{ background: "rgba(235,87,87,.12)", color: "var(--red)" }}
            >
              <Archive size={16} />
            </button>
          </div>
        </div>

        {editing && (
          <div className="grid md:grid-cols-3 gap-3 mt-5">
            <label className="flex flex-col gap-1.5 md:col-span-3">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Name</span>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Color</span>
              <input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} placeholder="#6B46F5" className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none" style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }} />
            </label>
            <button
              onClick={() => updateAccount.mutate()}
              disabled={updateAccount.isPending || !form.name}
              className="inline-flex items-center justify-center gap-2 rounded-(--r-sm) text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              <Save size={16} />
              {updateAccount.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-bold" style={{ color: "var(--ink)" }}>Recent transactions</h3>
          <Link href={`/transactions?accountId=${id}`} className="text-sm font-bold" style={{ color: "var(--violet)" }}>View all</Link>
        </div>
        {txLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-(--r-md)" />)}
          </div>
        ) : (transactions?.data ?? []).length === 0 ? (
          <div className="rounded-(--r-lg) p-8 text-center" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
            <div className="font-bold" style={{ color: "var(--ink)" }}>No transactions yet</div>
            <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>Transactions linked to this account will appear here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(transactions?.data ?? []).map((transaction) => (
              <TransactionRow key={String(transaction._id)} transaction={transaction} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
