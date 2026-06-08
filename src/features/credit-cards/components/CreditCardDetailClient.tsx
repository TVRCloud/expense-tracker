"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Archive, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { useTransactions } from "@/features/transactions/hooks/useTransactions";
import { TransactionRow } from "@/features/transactions/components/TransactionRow";
import { CreditCardBanner } from "./CreditCardBanner";
import { EmiCommitmentCard } from "./EmiCommitmentCard";
import { StatementList } from "./StatementList";
import { CreditCardForm } from "./CreditCardForm";
import { useRecurringSeriesList } from "@/features/recurring/hooks/useRecurringSeries";
import { type IAccount, type ICreditMeta } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  id: string;
}

export function CreditCardDetailClient({ id }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", color: "", icon: "" });
  const [creditMeta, setCreditMeta] = useState<Partial<ICreditMeta>>({});

  const { data: account, isLoading, isError } = useQuery<IAccount>({
    queryKey: ["accounts", id],
    queryFn: async () => {
      const res = await apiClient.get<{ data: IAccount }>(`/accounts/${id}`);
      return res.data.data;
    },
  });

  const { data: seriesData } = useRecurringSeriesList(id);
  const { data: transactions, isLoading: txLoading } = useTransactions({ accountId: id, limit: 10 });

  useEffect(() => {
    if (!account) return;
    setForm({ name: account.name ?? "", color: account.color ?? "", icon: account.icon ?? "" });
    if (account.creditMeta) setCreditMeta(account.creditMeta);
  }, [account]);

  const updateAccount = useMutation({
    mutationFn: () =>
      apiClient.patch(`/accounts/${id}`, {
        name: form.name,
        color: form.color || undefined,
        icon: form.icon || undefined,
        creditMeta,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["accounts", id] });
      void qc.invalidateQueries({ queryKey: ["credit-statements", id] });
      setEditing(false);
      toast.success("Card updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveAccount = useMutation({
    mutationFn: () => apiClient.delete(`/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Card archived");
      router.push("/accounts");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const recalculateBalance = useMutation({
    mutationFn: () => apiClient.post(`/accounts/${id}/recalculate`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["accounts", id] });
      void qc.invalidateQueries({ queryKey: ["credit-statements", id] });
      toast.success("Balance recalculated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-28 rounded-(--r-sm)" />
        <Skeleton className="h-52 rounded-(--r-lg)" />
        <Skeleton className="h-72 rounded-(--r-lg)" />
      </div>
    );
  }

  if (isError || !account) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/accounts" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
          <ArrowLeft size={16} /> Back to accounts
        </Link>
        <div className="rounded-(--r-lg) p-8 text-center" style={{ background: "var(--card)" }}>
          <div className="font-bold" style={{ color: "var(--ink)" }}>Card not found</div>
        </div>
      </div>
    );
  }

  const emiCommitment = (seriesData?.data ?? []).reduce(
    (s: number, sr: { remainingCount: number; amount: number }) => s + sr.amount * sr.remainingCount,
    0
  );
  // Use account.balance (paid transactions only) as the base to avoid double-counting
  // unpaid EMI installments that also appear in statements?.currentCycle?.balance.
  const currentBalance = Math.abs(Math.min(0, account.balance)) + emiCommitment;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/accounts" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: "var(--violet)" }}>
        <ArrowLeft size={16} /> Back to accounts
      </Link>

      {/* Card header / banner */}
      <CreditCardBanner account={account} currentBalance={currentBalance} />

      {/* EMI commitment summary */}
      <EmiCommitmentCard accountId={id} />

      {/* Edit section */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setEditing(v => !v)}
          className="px-4 py-2 rounded-(--r-sm) text-sm font-bold"
          style={{ background: "var(--card)", color: "var(--ink-2)", boxShadow: "var(--shadow-sm)" }}
        >
          {editing ? "Cancel" : "Edit Card"}
        </button>
        <button
          onClick={() => recalculateBalance.mutate()}
          disabled={recalculateBalance.isPending}
          title="Recalculate balance from transactions"
          className="px-3 py-2 rounded-(--r-sm) text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: "var(--card)", color: "var(--ink-2)", boxShadow: "var(--shadow-sm)" }}
        >
          <RefreshCw size={14} className={recalculateBalance.isPending ? "animate-spin" : ""} />
        </button>
        <button
          onClick={() => { if (confirm(`Archive "${account.name}"?`)) archiveAccount.mutate(); }}
          disabled={archiveAccount.isPending}
          className="px-4 py-2 rounded-(--r-sm) text-sm font-bold"
          style={{ background: "rgba(235,87,87,.1)", color: "var(--red)" }}
        >
          <Archive size={14} />
        </button>
      </div>

      {editing && (
        <div className="rounded-(--r-lg) p-5 flex flex-col gap-4" style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>Edit Card</div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Name</span>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
            />
          </label>
          <CreditCardForm value={creditMeta} onChange={setCreditMeta} />
          <button
            onClick={() => updateAccount.mutate()}
            disabled={updateAccount.isPending || !form.name}
            className="inline-flex items-center justify-center gap-2 py-2.5 rounded-(--r-sm) text-sm font-bold disabled:opacity-50"
            style={{ background: "var(--violet)", color: "#fff" }}
          >
            <Save size={15} />
            {updateAccount.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}

      {/* Statements */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-bold px-1" style={{ color: "var(--ink)" }}>Billing Statements</h3>
        <StatementList accountId={id} account={account} />
      </section>

      {/* Recent transactions */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-bold" style={{ color: "var(--ink)" }}>Recent Transactions</h3>
          <Link href={`/transactions?accountId=${id}`} className="text-sm font-bold" style={{ color: "var(--violet)" }}>View all</Link>
        </div>
        {txLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-(--r-md)" />)}
          </div>
        ) : (transactions?.data ?? []).length === 0 ? (
          <div className="rounded-(--r-lg) p-8 text-center" style={{ background: "var(--card)" }}>
            <div className="font-bold" style={{ color: "var(--ink)" }}>No transactions yet</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(transactions?.data ?? []).map(tx => <TransactionRow key={String(tx._id)} transaction={tx} />)}
          </div>
        )}
      </section>
    </div>
  );
}
