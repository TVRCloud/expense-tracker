"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Archive, ChevronRight, CreditCard } from "lucide-react";
import Link from "next/link";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { useRecurringSeriesList } from "@/features/recurring/hooks/useRecurringSeries";
import { CreditCardForm } from "@/features/credit-cards/components/CreditCardForm";
import { type CardSummary, useCreditSummary } from "@/features/credit-cards/hooks/useCreditSummary";
import { computeUtilization, utilizationColor } from "@/lib/credit-card";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { type IAccount, type ICreditMeta } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Progress } from "@/components/_ui/Progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ACCOUNT_TYPE_ICONS } from "@/lib/icons";
import { accountCreateSchema } from "@/features/accounts/schemas/account.schema";

const ACCOUNT_TYPES = ["cash", "bank", "credit_card", "savings", "investment", "wallet"] as const;

type FilterKey = "all" | "credit_card" | "other";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "credit_card", label: "Credit Cards" },
  { key: "other", label: "Banks & More" },
];

function CreditRow({
  acc,
  onArchive,
  formatCurrency,
  emiCommitment = 0,
  summary,
}: {
  acc: IAccount;
  onArchive: () => void;
  formatCurrency: (n: number) => string;
  emiCommitment?: number;
  summary?: CardSummary;
}) {
  const meta = acc.creditMeta;
  const cycleExposure = summary?.balance ?? Math.abs(Math.min(0, acc.balance));
  const displayBalance = cycleExposure + emiCommitment;
  const limit = meta?.creditLimit ?? 0;
  const utilPct = limit > 0 ? computeUtilization(displayBalance, limit) : 0;
  const utilCol = utilizationColor(utilPct);
  const available = Math.max(0, limit - displayBalance);

  return (
    <Card as={Link} href={`/accounts/${String(acc._id)}`} elevation="raised" radius="md" className="flex items-center gap-4 px-4 py-4 group">
      <div className="w-12 h-12 rounded-[14px] grid place-items-center flex-none" style={{ background: "var(--card-2)" }}>
        <CreditCard size={22} style={{ color: "var(--ink-2)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-bold text-sm truncate" style={{ color: "var(--ink)" }}>{acc.name}</div>
          {meta?.network && (
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--card-2)", color: "var(--ink-3)" }}>
              {meta.network}
            </span>
          )}
          {meta?.lastFourDigits && (
            <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>••{meta.lastFourDigits}</span>
          )}
        </div>
        {limit > 0 ? (
          <div className="mt-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
                {formatCurrency(displayBalance)} used · {formatCurrency(available)} available
              </span>
              <span className="text-[11px] font-bold" style={{ color: utilCol }}>
                {utilPct.toFixed(0)}%
              </span>
            </div>
            <Progress value={utilPct} color={utilCol} height={6} />
            <div className="text-[10px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
              Limit {formatCurrency(limit)}
            </div>
            {summary && (
              <div className="grid grid-cols-2 gap-2 mt-1.5 text-[10px] font-bold">
                <span className="tnum truncate" style={{ color: "var(--ink-3)" }}>
                  Payable {formatCurrency(summary.payableStatementDue ?? 0)}
                </span>
                <span className="tnum truncate text-right" style={{ color: "var(--ink-3)" }}>
                  Unbilled {formatCurrency(summary.unbilledUsage ?? 0)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>Credit card · Setup billing cycle</div>
        )}
        {emiCommitment > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>EMI</span>
            <span className="text-[10px] font-medium tnum" style={{ color: "var(--ink-3)" }}>
              {formatCurrency(emiCommitment)} commitment included
            </span>
          </div>
        )}
      </div>
      <ChevronRight size={16} className="flex-none opacity-40 group-hover:opacity-70 transition-opacity" style={{ color: "var(--ink-2)" }} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Archive ${acc.name}`}
        onClick={(e) => { e.preventDefault(); onArchive(); }}
        className="w-8 h-8 rounded-full flex-none"
        style={{ background: "var(--card-2)" }}
      >
        <Archive size={14} style={{ color: "var(--ink-3)" }} />
      </Button>
    </Card>
  );
}

function RegularRow({ acc, onArchive, formatCurrency }: { acc: IAccount; onArchive: () => void; formatCurrency: (n: number) => string }) {
  const TypeIcon = ACCOUNT_TYPE_ICONS[acc.type] ?? CreditCard;
  return (
    <Card as={Link} href={`/accounts/${String(acc._id)}`} elevation="raised" radius="md" className="flex items-center gap-4 px-4 py-4 group">
      <div className="w-12 h-12 rounded-[14px] grid place-items-center flex-none" style={{ background: "var(--card-2)" }}>
        <TypeIcon size={22} style={{ color: "var(--ink-2)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm" style={{ color: "var(--ink)" }}>{acc.name}</div>
        <div className="text-xs font-medium mt-0.5 capitalize" style={{ color: "var(--ink-3)" }}>
          {acc.type.replace("_", " ")}
        </div>
      </div>
      <div className="text-right mr-2">
        <div className="font-extrabold tnum text-[15px]" style={{ color: acc.balance >= 0 ? "var(--ink)" : "var(--red)" }}>
          {formatCurrency(acc.balance)}
        </div>
      </div>
      <ChevronRight size={16} className="flex-none opacity-40 group-hover:opacity-70 transition-opacity" style={{ color: "var(--ink-2)" }} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Archive ${acc.name}`}
        onClick={(e) => { e.preventDefault(); onArchive(); }}
        className="w-8 h-8 rounded-full flex-none"
        style={{ background: "var(--card-2)" }}
      >
        <Archive size={14} style={{ color: "var(--ink-3)" }} />
      </Button>
    </Card>
  );
}

export function AccountsClient() {
  const { formatCurrency, currency } = useCurrency();
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useAccounts();
  const { data: seriesData } = useRecurringSeriesList();
  const { data: creditSummary } = useCreditSummary();
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "bank" as IAccount["type"], currency });

  const openAdd = () => {
    setForm(f => ({ ...f, currency }));
    setShowAdd(true);
  };
  const [creditMeta, setCreditMeta] = useState<Partial<ICreditMeta>>({});

  // Build per-card EMI commitment map: cardId → total remaining cents
  const emiByCard = (seriesData?.data ?? []).reduce<Record<string, number>>((map, sr) => {
    if (sr.remainingCount > 0) {
      const key = String(sr.accountId);
      map[key] = (map[key] ?? 0) + sr.amount * sr.remainingCount;
    }
    return map;
  }, {});

  const filteredAccounts = (accounts ?? []).filter(a => {
    if (filter === "credit_card") return a.type === "credit_card";
    if (filter === "other") return a.type !== "credit_card";
    return true;
  });

  const creditCards = (accounts ?? []).filter(a => a.type === "credit_card");
  const totalCreditDebt = creditSummary?.totalCreditExposure
    ?? creditCards.reduce((sum, account) => sum + Math.abs(Math.min(0, account.balance)), 0);
  const creditSummaryByAccount = (creditSummary?.cards ?? []).reduce<Record<string, CardSummary>>((map, card) => {
    map[card.accountId] = card;
    return map;
  }, {});

  const createAccount = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { ...form, balance: 0 };
      if (form.type === "credit_card" && Object.keys(creditMeta).length > 0) {
        payload.creditMeta = creditMeta;
      }
      // Same zod schema the server validates with — one shared source of truth.
      const parsed = accountCreateSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid account");
      }
      return apiClient.post("/accounts", parsed.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowAdd(false);
      setForm({ name: "", type: "bank", currency });
      setCreditMeta({});
      toast.success("Account created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveAccount = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account archived");
    },
  });

  const requestArchive = async (acc: IAccount) => {
    const ok = await confirm({
      title: `Archive "${acc.name}"?`,
      description: "You can restore it later. Its transaction history stays intact.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (ok) archiveAccount.mutate(String(acc._id));
  };

  const nonCreditBalance = (accounts ?? [])
    .filter(a => a.type !== "credit_card")
    .reduce((s, a) => s + a.balance, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      {!isLoading && (accounts ?? []).length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card radius="lg" className="p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>Net Assets</div>
            <div className="text-[22px] font-extrabold tnum" style={{ color: "var(--ink)" }}>
              {formatCurrency(nonCreditBalance)}
            </div>
          </Card>
          {creditCards.length > 0 && (
            <Card radius="lg" className="p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>Credit Exposure</div>
              <div className="text-[22px] font-extrabold tnum" style={{ color: totalCreditDebt > 0 ? "var(--red)" : "var(--green)" }}>
                {formatCurrency(totalCreditDebt)}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Filter tabs */}
      {!isLoading && (accounts ?? []).length > 0 && (
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <TabsList className="h-auto w-max bg-transparent p-0 gap-2">
            {FILTERS.map(f => (
              <TabsTrigger
                key={f.key}
                value={f.key}
                className="h-auto px-3.5 py-1.5 rounded-full text-[12px] font-bold"
                style={{
                  background: filter === f.key ? "var(--violet)" : "var(--card)",
                  color: filter === f.key ? "var(--violet-fg)" : "var(--ink-2)",
                  boxShadow: filter === f.key ? "none" : "var(--shadow-sm)",
                }}
              >
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Account list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 rounded-(--r-md)" />)}
        </div>
      ) : filteredAccounts.length === 0 && !showAdd ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-16">
          <div className="text-4xl">🏦</div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>
            {filter === "credit_card" ? "No credit cards yet" : filter === "other" ? "No bank accounts yet" : "No accounts yet"}
          </p>
          <Button onClick={openAdd} className="h-auto text-sm px-4 py-2 rounded-full">
            Add account
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredAccounts.map(acc =>
            acc.type === "credit_card" ? (
              <CreditRow
                key={String(acc._id)}
                acc={acc}
                formatCurrency={formatCurrency}
                emiCommitment={emiByCard[String(acc._id)] ?? 0}
                summary={creditSummaryByAccount[String(acc._id)]}
                onArchive={() => requestArchive(acc)}
              />
            ) : (
              <RegularRow
                key={String(acc._id)}
                acc={acc}
                formatCurrency={formatCurrency}
                onArchive={() => requestArchive(acc)}
              />
            )
          )}
        </div>
      )}

      {/* Add account form */}
      {showAdd && (
        <Card radius="lg" elevation="floating" className="p-5 flex flex-col gap-4">
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>New Account</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Account name</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Chase Sapphire"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Type</Label>
              <Select
                value={form.type}
                onValueChange={(value) => {
                  setForm(f => ({ ...f, type: value as IAccount["type"] }));
                  if (value !== "credit_card") setCreditMeta({});
                }}
              >
                <SelectTrigger className="capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Currency</Label>
              <Select value={form.currency} onValueChange={(value) => setForm(f => ({ ...f, currency: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD"].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.type === "credit_card" && (
            <CreditCardForm value={creditMeta} onChange={setCreditMeta} />
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => createAccount.mutate()}
              disabled={createAccount.isPending || !form.name}
              className="flex-1 h-auto py-2.5 rounded-(--r-sm) font-bold"
            >
              {createAccount.isPending ? "Saving..." : "Create Account"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setShowAdd(false); setCreditMeta({}); }}
              className="h-auto px-5 py-2.5 rounded-(--r-sm) font-bold"
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {!showAdd && (accounts ?? []).length > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={openAdd}
          className="h-auto flex items-center justify-center gap-2 rounded-(--r-md) py-3.5 font-bold"
          style={{ color: "var(--violet)" }}
        >
          <Plus size={17} />
          Add Account
        </Button>
      )}
      {dialog}
    </div>
  );
}
