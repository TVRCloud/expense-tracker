"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Archive } from "lucide-react";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { type IAccount } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const ACCOUNT_TYPES = ["cash", "bank", "credit_card", "savings", "investment", "wallet"] as const;
const TYPE_ICONS: Record<string, string> = {
  cash: "💵", bank: "🏦", credit_card: "💳", savings: "🏦", investment: "📈", wallet: "👛",
};

export function AccountsClient() {
  const { formatCurrency } = useCurrency();
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useAccounts();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "bank" as IAccount["type"], currency: "USD" });

  const createAccount = useMutation({
    mutationFn: () => apiClient.post("/accounts", { ...form, balance: 0 }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowAdd(false);
      setForm({ name: "", type: "bank", currency: "USD" });
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

  const totalBalance = (accounts ?? []).reduce((s, a) => s + a.balance, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Total balance card */}
      {!isLoading && (accounts ?? []).length > 0 && (
        <div
          className="rounded-[var(--r-lg)] p-5"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Total balance
          </div>
          <div className="text-[32px] font-extrabold tnum mt-1" style={{ color: "var(--ink)" }}>
            {formatCurrency(totalBalance)}
          </div>
          <div className="text-sm font-medium mt-1" style={{ color: "var(--ink-3)" }}>
            {(accounts ?? []).length} account{(accounts ?? []).length !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Account list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 rounded-[var(--r-md)]" />)}
        </div>
      ) : (accounts ?? []).length === 0 && !showAdd ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] py-16"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="text-4xl">🏦</div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No accounts yet</p>
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
          {(accounts ?? []).map(acc => (
            <div
              key={String(acc._id)}
              className="flex items-center gap-4 rounded-[var(--r-md)] px-4 py-4"
              style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
            >
              <div
                className="w-12 h-12 rounded-[14px] grid place-items-center text-2xl flex-none"
                style={{ background: "var(--card-2)" }}
              >
                {TYPE_ICONS[acc.type] ?? "💳"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm" style={{ color: "var(--ink)" }}>{acc.name}</div>
                <div className="text-xs font-medium mt-0.5 capitalize" style={{ color: "var(--ink-3)" }}>
                  {acc.type.replace("_", " ")}
                </div>
              </div>
              <div className="text-right">
                <div
                  className="font-extrabold tnum text-[15px]"
                  style={{ color: acc.balance >= 0 ? "var(--ink)" : "var(--red)" }}
                >
                  {formatCurrency(acc.balance)}
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Archive "${acc.name}"?`)) archiveAccount.mutate(String(acc._id));
                }}
                className="w-8 h-8 rounded-full grid place-items-center flex-none"
                style={{ background: "var(--card-2)" }}
              >
                <Archive size={14} style={{ color: "var(--ink-3)" }} />
              </button>
            </div>
          ))}
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
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Account name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Main Checking"
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Type</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as IAccount["type"] }))}
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none capitalize"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              >
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              >
                {["USD","EUR","GBP","INR","JPY","CAD","AUD"].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => createAccount.mutate()}
              disabled={createAccount.isPending || !form.name}
              className="flex-1 py-2.5 rounded-[var(--r-sm)] text-sm font-bold"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              {createAccount.isPending ? "Saving..." : "Create Account"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-5 py-2.5 rounded-[var(--r-sm)] text-sm font-bold"
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
