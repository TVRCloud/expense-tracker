"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Archive, ChevronRight, CreditCard, Landmark } from "lucide-react";
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
import { Progress } from "@/components/_ui/Progress";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
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

const ICON_TILE = "w-11 h-11 rounded-[13px] grid place-items-center flex-none";

function ArchiveButton({ name, onArchive }: { name: string; onArchive: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Archive ${name}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onArchive(); }}
      className="w-8 h-8 rounded-full flex-none opacity-60 hover:opacity-100 active:scale-[0.96] transition"
    >
      <Archive size={14} style={{ color: "var(--ink-3)" }} />
    </Button>
  );
}

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
    <Card as={Link} href={`/accounts/${String(acc._id)}`} elevation="raised" radius="lg" interactive className="flex flex-col gap-4 p-5 group min-w-0 active:scale-[0.99] transition-transform">
      <div className="flex items-center gap-3 min-w-0">
        <div className={ICON_TILE} style={{ background: "var(--card-2)" }}>
          <CreditCard size={20} style={{ color: "var(--ink-2)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{acc.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
            <span>Credit card</span>
            {meta?.network && <span className="uppercase">· {meta.network}</span>}
            {meta?.lastFourDigits && <span className="tnum">· ••{meta.lastFourDigits}</span>}
          </div>
        </div>
        <ArchiveButton name={acc.name} onArchive={onArchive} />
      </div>

      {limit > 0 ? (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>Used</div>
              <div className="tnum truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)" }}>
                {formatCurrency(displayBalance)}
              </div>
            </div>
            <span className="tnum rounded-full px-2.5 py-1" style={{ font: "var(--text-micro)", fontWeight: 600, color: utilCol, background: "var(--card-2)" }}>
              {utilPct.toFixed(0)}% used
            </span>
          </div>
          <div>
            <Progress value={utilPct} color={utilCol} trackColor="var(--line)" height={6} />
            <div className="flex justify-between mt-2 tnum" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
              <span>{formatCurrency(available)} available</span>
              <span>Limit {formatCurrency(limit)}</span>
            </div>
          </div>
          {summary && (
            <div className="grid grid-cols-2 gap-2 pt-3 tnum" style={{ borderTop: "1px solid var(--line)", font: "var(--text-micro)", color: "var(--ink-3)" }}>
              <span className="truncate">Payable {formatCurrency(summary.payableStatementDue ?? 0)}</span>
              <span className="truncate text-right">Unbilled {formatCurrency(summary.unbilledUsage ?? 0)}</span>
            </div>
          )}
        </>
      ) : (
        <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Set up billing cycle</div>
      )}
      {emiCommitment > 0 && (
        <div className="tnum" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
          EMI {formatCurrency(emiCommitment)} commitment included
        </div>
      )}
    </Card>
  );
}

function RegularRow({ acc, onArchive, formatCurrency }: { acc: IAccount; onArchive: () => void; formatCurrency: (n: number) => string }) {
  const TypeIcon = ACCOUNT_TYPE_ICONS[acc.type] ?? CreditCard;
  return (
    <Card as={Link} href={`/accounts/${String(acc._id)}`} elevation="raised" radius="lg" interactive className="flex flex-col gap-5 p-5 group min-w-0 active:scale-[0.99] transition-transform">
      <div className="flex items-center gap-3 min-w-0">
        <div className={ICON_TILE} style={{ background: acc.color || "var(--card-2)" }}>
          <TypeIcon size={20} style={{ color: acc.color ? "var(--violet-fg)" : "var(--ink-2)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{acc.name}</div>
          <div className="capitalize mt-0.5" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
            {acc.type.replace("_", " ")} · {acc.currency}
          </div>
        </div>
        <ArchiveButton name={acc.name} onArchive={onArchive} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="tnum truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: acc.balance >= 0 ? "var(--ink)" : "var(--red)" }}>
          {formatCurrency(acc.balance)}
        </div>
        <ChevronRight size={16} className="flex-none opacity-40 group-hover:opacity-70 transition-opacity mb-1.5" style={{ color: "var(--ink-2)" }} />
      </div>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card radius="lg" className="p-5 min-w-0">
      <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{label}</div>
      <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: color ?? "var(--ink)" }}>
        {value}
      </div>
    </Card>
  );
}

export function AccountsClient() {
  const { formatCurrency, currency } = useCurrency();
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useAccounts();
  const { data: seriesData } = useRecurringSeriesList();
  const { data: creditSummary } = useCreditSummary();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "bank" as IAccount["type"], currency });

  const openAdd = () => {
    setForm(f => ({ ...f, currency }));
    setShowAdd(true);
  };
  const [creditMeta, setCreditMeta] = useState<Partial<ICreditMeta>>({});
  const [smsDigits, setSmsDigits] = useState("");

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
      const digits = smsDigits.split(/[,\s]+/).filter(Boolean);
      if (digits.length) payload.smsLastFour = digits;
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
      setSmsDigits("");
      toast.success("Account created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Archiving is reversible, so it happens at once with Undo in the toast
  // instead of asking first.
  const restoreAccount = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/accounts/${id}`, { isArchived: false }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["accounts"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveAccount = useMutation({
    mutationFn: (acc: IAccount) => apiClient.delete(`/accounts/${acc._id}`),
    onSuccess: (_res, acc) => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(`Archived ${acc.name}`, {
        action: { label: "Undo", onClick: () => restoreAccount.mutate(String(acc._id)) },
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const requestArchive = (acc: IAccount) => archiveAccount.mutate(acc);

  const nonCreditBalance = (accounts ?? [])
    .filter(a => a.type !== "credit_card")
    .reduce((s, a) => s + a.balance, 0);

  const nameError = form.name.trim() === "" ? "Name is required" : null;
  const hasAccounts = (accounts ?? []).length > 0;
  const closeAdd = () => { setShowAdd(false); setCreditMeta({}); setSmsDigits(""); };

  return (
    <div className="page-stack">
      <PageHeader
        title="Accounts"
        subtitle="Everything you own and owe, in one place."
        actions={
          <Button type="button" onClick={openAdd} className="h-11 px-5 rounded-full font-semibold btn-interactive">
            <Plus size={16} />
            Add account
          </Button>
        }
      />

      {!isLoading && hasAccounts && (
        <div className="grid-cards" style={{ "--card-min": "220px" } as React.CSSProperties}>
          <Stat label="Net worth" value={formatCurrency(nonCreditBalance - totalCreditDebt)} color={nonCreditBalance - totalCreditDebt < 0 ? "var(--red)" : undefined} />
          <Stat label="Assets" value={formatCurrency(nonCreditBalance)} />
          {creditCards.length > 0 && (
            <Stat label="Credit exposure" value={formatCurrency(totalCreditDebt)} color={totalCreditDebt > 0 ? "var(--red)" : "var(--green)"} />
          )}
        </div>
      )}

      {!isLoading && hasAccounts && (
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <TabsList className="h-10 w-max p-1 rounded-full" style={{ background: "var(--card-2)" }}>
            {FILTERS.map(f => (
              <TabsTrigger
                key={f.key}
                value={f.key}
                className="h-8 px-4 rounded-full font-semibold border-0 shadow-none data-[state=active]:shadow-(--shadow-sm) active:scale-[0.97] transition"
                style={{
                  font: "var(--text-label)",
                  fontWeight: 600,
                  background: filter === f.key ? "var(--card)" : "transparent",
                  color: filter === f.key ? "var(--ink)" : "var(--ink-2)",
                }}
              >
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {isLoading ? (
        <div className="grid-cards" style={{ "--card-min": "300px" } as React.CSSProperties}>
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-36 rounded-(--r-lg)" />)}
        </div>
      ) : filteredAccounts.length === 0 ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-20 text-center px-6">
          <div className="w-14 h-14 rounded-2xl grid place-items-center" style={{ background: "var(--card-2)" }}>
            <Landmark size={26} style={{ color: "var(--ink-2)" }} />
          </div>
          <p style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>
            {filter === "credit_card" ? "No credit cards yet" : filter === "other" ? "No bank accounts yet" : "No accounts yet"}
          </p>
          <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Add one to start tracking balances.</p>
          <Button onClick={openAdd} className="h-11 px-5 rounded-full font-semibold btn-interactive">Add account</Button>
        </Card>
      ) : (
        <div className="grid-cards" style={{ "--card-min": "300px" } as React.CSSProperties}>
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

      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) closeAdd(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 gap-0 border-0 sm:max-w-lg" style={{ background: "var(--card)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)" }}>
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>New account</DialogTitle>
            <DialogDescription style={{ color: "var(--ink-3)" }}>Name it, pick a type, and you are set.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5 px-6 pb-6 pt-3"
            onSubmit={(e) => { e.preventDefault(); if (!nameError) createAccount.mutate(); }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="accounts-client-account-name-1" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>Account name</Label>
              <Input id="accounts-client-account-name-1"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Chase Sapphire"
                autoFocus
                className="h-11"
              />
              {nameError && form.name.length > 0 && <span style={{ font: "var(--text-micro)", color: "var(--red)" }}>{nameError}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-account-type" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) => {
                    setForm(f => ({ ...f, type: value as IAccount["type"] }));
                    if (value !== "credit_card") setCreditMeta({});
                  }}
                >
                  <SelectTrigger id="new-account-type" className="capitalize h-11 w-full">
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
                <Label htmlFor="new-account-currency" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>Currency</Label>
                <Select value={form.currency} onValueChange={(value) => setForm(f => ({ ...f, currency: value }))}>
                  <SelectTrigger id="new-account-currency" className="h-11 w-full">
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

            {(form.type === "bank" || form.type === "savings") && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-account-sms-digits" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
                  SMS match digits <span style={{ color: "var(--ink-3)" }}>(optional)</span>
                </Label>
                <Input
                  id="new-account-sms-digits"
                  value={smsDigits}
                  inputMode="numeric"
                  onChange={(e) => setSmsDigits(e.target.value.replace(/[^\d,\s]/g, ""))}
                  placeholder="e.g. 6390"
                  aria-describedby="new-account-sms-digits-hint"
                  className="h-11"
                />
                <span id="new-account-sms-digits-hint" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                  The last 4 digits your bank shows in SMS, like “A/C *6390”. Payments with them go to this account.
                </span>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
              <Button type="button" variant="ghost" onClick={closeAdd} className="h-11 px-5 rounded-full font-semibold">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createAccount.isPending || !!nameError}
                className="h-11 px-6 rounded-full font-semibold btn-interactive"
              >
                {createAccount.isPending ? "Saving..." : "Create account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
