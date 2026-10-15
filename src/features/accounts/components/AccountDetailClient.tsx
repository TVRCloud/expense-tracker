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
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";

interface Props {
  id: string;
}

export function AccountDetailClient({ id }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { formatCurrency } = useCurrency();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", color: "", smsLastFour: "" });

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
      smsLastFour: (account.smsLastFour ?? []).join(", "),
    });
  }, [account]);

  const updateAccount = useMutation({
    mutationFn: () =>
      apiClient.patch(`/accounts/${id}`, {
        name: form.name,
        color: form.color || undefined,
        smsLastFour: [...new Set(form.smsLastFour.split(/[\s,]+/).filter((d) => /^\d{4}$/.test(d)))],
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

  const labelStyle = { font: "var(--text-label)", color: "var(--ink-2)" } as const;

  if (isLoading) {
    return (
      <div className="page-stack">
        <Skeleton className="h-9 w-32 rounded-(--r-sm)" />
        <Skeleton className="h-44 rounded-(--r-lg)" />
        <div className="grid-split">
          <Skeleton className="h-72 rounded-(--r-lg)" />
          <Skeleton className="h-56 rounded-(--r-lg) rail" />
        </div>
      </div>
    );
  }

  if (isError || !account) {
    return (
      <div className="page-stack">
        <Link href="/accounts" className="inline-flex items-center gap-1.5 min-h-11 w-max" style={{ font: "var(--text-label)", fontWeight: 600, color: "var(--ink-2)" }}>
          <ArrowLeft size={16} />
          Accounts
        </Link>
        <Card radius="lg" className="p-10 text-center">
          <div style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>Account not found</div>
          <p className="mt-1" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>It may have been archived or deleted.</p>
        </Card>
      </div>
    );
  }

  // Delegate credit cards to specialised view
  if (account.type === "credit_card") {
    return <CreditCardDetailClient id={id} />;
  }

  const TypeIcon = ACCOUNT_TYPE_ICONS[account.type] ?? CreditCard;
  const txs = transactions?.data ?? [];

  return (
    <div className="page-stack">
      <Link href="/accounts" className="inline-flex items-center gap-1.5 min-h-11 w-max active:opacity-60 transition-opacity" style={{ font: "var(--text-label)", fontWeight: 600, color: "var(--ink-2)" }}>
        <ArrowLeft size={16} />
        Accounts
      </Link>

      <Card radius="lg" elevation="floating" className="p-5 sm:p-7">
        <div className="flex flex-wrap items-start gap-4">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center flex-none"
            style={{ background: account.color || "var(--card-2)", color: account.color ? "var(--violet-fg)" : "var(--ink-2)" }}
          >
            <TypeIcon size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="capitalize" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
              {account.type.replace("_", " ")} · {account.currency}
            </div>
            <h1 className="truncate" style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>{account.name}</h1>
          </div>
          <div className="flex gap-2 flex-none">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing((value) => !value)}
              className="h-11 px-5 rounded-full font-semibold btn-interactive"
            >
              {editing ? "Cancel" : "Edit"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Archive account"
              onClick={async () => {
                const ok = await confirm({
                  title: `Archive "${account.name}"?`,
                  description: "You can restore it later from an archived-accounts view. Its balance history stays intact.",
                  confirmLabel: "Archive",
                  destructive: true,
                });
                if (ok) archiveAccount.mutate();
              }}
              disabled={archiveAccount.isPending}
              className="w-11 h-11 rounded-full active:scale-[0.96] transition"
              style={{ background: "color-mix(in srgb, var(--red) 12%, transparent)", color: "var(--red)" }}
            >
              <Archive size={16} />
            </Button>
          </div>
        </div>
        <div className="mt-6">
          <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Balance</div>
          <div className="tnum truncate" style={{ font: "var(--text-display)", letterSpacing: "var(--track-title)", color: account.balance >= 0 ? "var(--ink)" : "var(--red)" }}>
            {formatCurrency(account.balance)}
          </div>
        </div>
      </Card>

      <div className="grid-split">
        <section>
          <div className="section-head">
            <h2>Recent transactions</h2>
            <Link href={`/transactions?accountId=${id}`} style={{ font: "var(--text-label)", fontWeight: 600, color: "var(--ink-2)" }}>View all</Link>
          </div>
          {txLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-(--r-md)" />)}
            </div>
          ) : txs.length === 0 ? (
            <Card radius="lg" className="p-10 text-center">
              <div style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>No transactions yet</div>
              <p className="mt-1" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Transactions linked to this account will appear here.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {txs.map((transaction) => (
                <TransactionRow key={String(transaction._id)} transaction={transaction} />
              ))}
            </div>
          )}
        </section>

        <aside className="rail">
          <div className="section-head"><h2>Details</h2></div>
          {editing ? (
            <Card radius="lg" className="p-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="account-detail-client-name-1" style={labelStyle}>Name</Label>
                <Input id="account-detail-client-name-1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-11" />
                {!form.name.trim() && <span style={{ font: "var(--text-micro)", color: "var(--red)" }}>Name is required</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="account-detail-client-color-2" style={labelStyle}>Color</Label>
                <Input id="account-detail-client-color-2" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} placeholder="#6B46F5" className="h-11" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="account-detail-client-sms-match-digits-3" style={labelStyle}>SMS match digits</Label>
                <Input id="account-detail-client-sms-match-digits-3"
                  value={form.smsLastFour}
                  inputMode="numeric"
                  onChange={(e) => setForm((f) => ({ ...f, smsLastFour: e.target.value.replace(/[^\d,\s]/g, "") }))}
                  placeholder="e.g. 1234 (from “A/c XX1234”)"
                  aria-describedby="sms-digits-hint"
                  className="h-11"
                />
                <span id="sms-digits-hint" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                  Last 4 digits your bank shows in SMS. Captured payments with these digits go to this account.
                </span>
              </div>
              <Button
                type="button"
                onClick={() => updateAccount.mutate()}
                disabled={updateAccount.isPending || !form.name}
                className="h-11 rounded-full font-semibold btn-interactive"
              >
                <Save size={16} />
                {updateAccount.isPending ? "Saving..." : "Save changes"}
              </Button>
            </Card>
          ) : (
            <div className="inset-group" style={{ "--inset": "16px" } as React.CSSProperties}>
              {[
                { k: "Type", v: account.type.replace("_", " "), cap: true },
                { k: "Currency", v: account.currency },
                { k: "SMS match digits", v: (account.smsLastFour ?? []).join(", ") || "None" },
              ].map((row) => (
                <div key={row.k} className="flex items-center justify-between gap-4 px-4 min-h-12">
                  <span style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{row.k}</span>
                  <span className={row.cap ? "capitalize truncate" : "truncate tnum"} style={{ font: "var(--text-label)", fontWeight: 600, color: "var(--ink)" }}>{row.v}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      {dialog}
    </div>
  );
}
