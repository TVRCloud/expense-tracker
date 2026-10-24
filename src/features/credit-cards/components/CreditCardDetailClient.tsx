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
import { CardRewardsCard } from "./CardRewardsCard";
import { StatementList } from "./StatementList";
import { CreditCardForm } from "./CreditCardForm";
import { useRecurringSeriesList } from "@/features/recurring/hooks/useRecurringSeries";
import { useCreditStatements } from "@/features/credit-cards/hooks/useCreditStatements";
import { type IAccount, type ICreditMeta } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";

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
  const { data: statementsData } = useCreditStatements(id);
  const { data: transactions, isLoading: txLoading } = useTransactions({ accountId: id, limit: 10, includeUnpaidRecurring: true });

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

  // Reversible: archive at once, Undo in the toast (no confirm dialog).
  const archiveAccount = useMutation({
    mutationFn: () => apiClient.delete(`/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(`Archived ${account?.name ?? "card"}`, {
        action: {
          label: "Undo",
          onClick: () =>
            void apiClient
              .patch(`/accounts/${id}`, { isArchived: false })
              .then(() => qc.invalidateQueries({ queryKey: ["accounts"] }))
              .catch((err: Error) => toast.error(err.message)),
        },
      });
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
        <Card radius="lg" className="p-8 text-center">
          <div className="font-bold" style={{ color: "var(--ink)" }}>Card not found</div>
        </Card>
      </div>
    );
  }

  const emiCommitment = (seriesData?.data ?? []).reduce(
    (s: number, sr: { remainingCount: number; amount: number }) => s + sr.amount * sr.remainingCount,
    0
  );
  const unbilledUsage = statementsData?.currentCycle?.unbilledUsage ?? 0;
  const payableStatementDue = statementsData?.currentCycle?.payableStatementDue ?? 0;
  const nextPayableStatement = (statementsData?.data ?? [])
    .filter((statement) => (statement.remainingDue ?? 0) > 0)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
  const currentBalance = unbilledUsage + payableStatementDue + emiCommitment;

  return (
    <div className="page-stack">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/accounts" className="inline-flex items-center gap-1.5 text-sm font-semibold min-h-11" style={{ color: "var(--violet)" }}>
          <ArrowLeft size={16} /> Accounts
        </Link>
        <div className="flex gap-2 items-center">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditing(v => !v)}
            className="h-10 px-4 rounded-full font-semibold"
          >
            {editing ? "Cancel" : "Edit card"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={() => recalculateBalance.mutate()}
            disabled={recalculateBalance.isPending}
            aria-label="Recalculate balance from transactions"
          >
            <RefreshCw size={14} className={recalculateBalance.isPending ? "animate-spin" : ""} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Archive ${account.name}`}
            onClick={() => archiveAccount.mutate()}
            disabled={archiveAccount.isPending}
            className="h-10 w-10 rounded-full"
            style={{ background: "color-mix(in srgb, var(--red) 10%, transparent)", color: "var(--red)" }}
          >
            <Archive size={14} />
          </Button>
        </div>
      </div>

      {/* Card header / banner */}
      <CreditCardBanner
        account={account}
        currentBalance={currentBalance}
        unbilledUsage={unbilledUsage}
        payableStatementDue={payableStatementDue}
        payableDueDate={nextPayableStatement?.dueDate}
      />

      {editing && (
        <Card radius="lg" elevation="floating" className="p-5 sm:p-6 flex flex-col gap-4">
          <h2 style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>Edit card</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="credit-card-detail-client-name-1" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Name</Label>
            <Input id="credit-card-detail-client-name-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <CreditCardForm value={creditMeta} onChange={setCreditMeta} />
          <Button
            onClick={() => updateAccount.mutate()}
            disabled={updateAccount.isPending || !form.name}
            className="h-11 rounded-full font-semibold sm:self-end sm:px-8"
          >
            <Save size={15} />
            {updateAccount.isPending ? "Saving..." : "Save changes"}
          </Button>
        </Card>
      )}

      <div className="grid-split">
        <div className="min-w-0 flex flex-col gap-6">
          {/* Statements */}
          <section>
            <div className="section-head"><h2>Billing statements</h2></div>
            <StatementList accountId={id} account={account} />
          </section>

          {/* Recent transactions */}
          <section>
            <div className="section-head">
              <h2>Recent transactions</h2>
              <Link href={`/transactions?accountId=${id}`} className="text-sm font-semibold" style={{ color: "var(--violet)" }}>View all</Link>
            </div>
            {txLoading ? (
              <Skeleton className="h-48 rounded-(--r-md)" />
            ) : (transactions?.data ?? []).length === 0 ? (
              <Card radius="lg" className="p-8 text-center">
                <div className="font-semibold" style={{ color: "var(--ink)" }}>No transactions yet</div>
              </Card>
            ) : (
              <div className="inset-group" style={{ "--inset": "72px" } as React.CSSProperties}>
                {(transactions?.data ?? []).map(tx => <TransactionRow key={String(tx._id)} transaction={tx} grouped />)}
              </div>
            )}
          </section>
        </div>

        <aside className="rail flex flex-col gap-5">
          {/* EMI commitment summary */}
          <EmiCommitmentCard accountId={id} />
          <CardRewardsCard accountId={id} />
        </aside>
      </div>
    </div>
  );
}
