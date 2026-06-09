"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Archive, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { useRecurringSeriesList } from "@/features/recurring/hooks/useRecurringSeries";
import { CreditCardForm } from "@/features/credit-cards/components/CreditCardForm";
import { type CardSummary, useCreditSummary } from "@/features/credit-cards/hooks/useCreditSummary";
import { computeUtilization, utilizationColor } from "@/lib/credit-card";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { type IAccount, type ICreditMeta } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const ACCOUNT_TYPES = ["cash", "bank", "credit_card", "savings", "investment", "wallet"] as const;
const TYPE_ICONS: Record<string, string> = {
  cash: "💵", bank: "🏦", credit_card: "💳", savings: "🏦", investment: "📈", wallet: "👛",
};

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
    <Link
      href={`/accounts/${String(acc._id)}`}
      className="flex items-center gap-4 rounded-[var(--r-md)] px-4 py-4 group"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="w-12 h-12 rounded-[14px] grid place-items-center text-2xl flex-none" style={{ background: "var(--card-2)" }}>
        💳
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
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line-2)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, utilPct)}%`, background: utilCol }}
              />
            </div>
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
      <button
        type="button"
        onClick={e => { e.preventDefault(); onArchive(); }}
        className="w-8 h-8 rounded-full grid place-items-center flex-none"
        style={{ background: "var(--card-2)" }}
      >
        <Archive size={14} style={{ color: "var(--ink-3)" }} />
      </button>
    </Link>
  );
}

function RegularRow({ acc, onArchive, formatCurrency }: { acc: IAccount; onArchive: () => void; formatCurrency: (n: number) => string }) {
  return (
    <Link
      href={`/accounts/${String(acc._id)}`}
      className="flex items-center gap-4 rounded-[var(--r-md)] px-4 py-4 group"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="w-12 h-12 rounded-[14px] grid place-items-center text-2xl flex-none" style={{ background: "var(--card-2)" }}>
        {TYPE_ICONS[acc.type] ?? "💳"}
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
      <button
        type="button"
        onClick={e => { e.preventDefault(); onArchive(); }}
        className="w-8 h-8 rounded-full grid place-items-center flex-none"
        style={{ background: "var(--card-2)" }}
      >
        <Archive size={14} style={{ color: "var(--ink-3)" }} />
      </button>
    </Link>
  );
}

export function AccountsClient() {
  const { formatCurrency } = useCurrency();
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useAccounts();
  const { data: seriesData } = useRecurringSeriesList();
  const { data: creditSummary } = useCreditSummary();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "bank" as IAccount["type"], currency: "USD" });
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
      return apiClient.post("/accounts", payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowAdd(false);
      setForm({ name: "", type: "bank", currency: "USD" });
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

  const nonCreditBalance = (accounts ?? [])
    .filter(a => a.type !== "credit_card")
    .reduce((s, a) => s + a.balance, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      {!isLoading && (accounts ?? []).length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[var(--r-lg)] p-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>Net Assets</div>
            <div className="text-[22px] font-extrabold tnum" style={{ color: "var(--ink)" }}>
              {formatCurrency(nonCreditBalance)}
            </div>
          </div>
          {creditCards.length > 0 && (
            <div className="rounded-[var(--r-lg)] p-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--ink-3)" }}>Credit Exposure</div>
              <div className="text-[22px] font-extrabold tnum" style={{ color: totalCreditDebt > 0 ? "var(--red)" : "var(--green)" }}>
                {formatCurrency(totalCreditDebt)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter tabs */}
      {!isLoading && (accounts ?? []).length > 0 && (
        <div className="flex gap-2">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all"
              style={{
                background: filter === f.key ? "var(--violet)" : "var(--card)",
                color: filter === f.key ? "#fff" : "var(--ink-2)",
                boxShadow: filter === f.key ? "none" : "var(--shadow-sm)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Account list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 rounded-[var(--r-md)]" />)}
        </div>
      ) : filteredAccounts.length === 0 && !showAdd ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] py-16"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="text-4xl">🏦</div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>
            {filter === "credit_card" ? "No credit cards yet" : filter === "other" ? "No bank accounts yet" : "No accounts yet"}
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm font-bold px-4 py-2 rounded-full"
            style={{ background: "var(--violet)", color: "#fff" }}
          >
            Add account
          </button>
        </div>
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
                onArchive={() => { if (confirm(`Archive "${acc.name}"?`)) archiveAccount.mutate(String(acc._id)); }}
              />
            ) : (
              <RegularRow
                key={String(acc._id)}
                acc={acc}
                formatCurrency={formatCurrency}
                onArchive={() => { if (confirm(`Archive "${acc.name}"?`)) archiveAccount.mutate(String(acc._id)); }}
              />
            )
          )}
        </div>
      )}

      {/* Add account form */}
      {showAdd && (
        <div
          className="rounded-[var(--r-lg)] p-5 flex flex-col gap-4"
          style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
        >
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>New Account</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 col-span-2">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Account name</span>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Chase Sapphire"
                className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Type</span>
              <select
                value={form.type}
                onChange={e => {
                  setForm(f => ({ ...f, type: e.target.value as IAccount["type"] }));
                  if (e.target.value !== "credit_card") setCreditMeta({});
                }}
                className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none capitalize"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              >
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Currency</span>
              <select
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              >
                {["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD"].map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>

          {form.type === "credit_card" && (
            <CreditCardForm value={creditMeta} onChange={setCreditMeta} />
          )}

          <div className="flex gap-3">
            <button
              onClick={() => createAccount.mutate()}
              disabled={createAccount.isPending || !form.name}
              className="flex-1 py-2.5 rounded-(--r-sm) text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              {createAccount.isPending ? "Saving..." : "Create Account"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setCreditMeta({}); }}
              className="px-5 py-2.5 rounded-(--r-sm) text-sm font-bold"
              style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!showAdd && (accounts ?? []).length > 0 && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center justify-center gap-2 rounded-[var(--r-md)] py-3.5 text-sm font-bold"
          style={{ background: "var(--card)", color: "var(--violet)", boxShadow: "var(--shadow-sm)" }}
        >
          <Plus size={17} />
          Add Account
        </button>
      )}
    </div>
  );
}
