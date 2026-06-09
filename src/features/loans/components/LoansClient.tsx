"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowDownLeft, ArrowUpRight, Trash2, Receipt } from "lucide-react";
import { format } from "date-fns";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { type ILoan, type IRepayment } from "@/types/models";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { toast } from "sonner";

function useLoans(direction?: string) {
  return useQuery<ILoan[]>({
    queryKey: ["loans", direction],
    queryFn: async () => {
      const qs = direction ? `?direction=${direction}` : "";
      const res = await apiClient.get<{ data: ILoan[] }>(`/loans${qs}`);
      return res.data.data;
    },
  });
}

const TABS = [
  { label: "All", value: "" },
  { label: "Lent", value: "given" },
  { label: "Borrowed", value: "received" },
];

interface LoanForm {
  direction: "given" | "received";
  counterparty: string;
  principalAmount: string;
  startDate: string;
  dueDate?: Date;
  accountId: string;
  note: string;
}

function createEmptyLoanForm(): LoanForm {
  return {
    direction: "received",
    counterparty: "",
    principalAmount: "",
    startDate: format(new Date(), "yyyy-MM-dd"),
    dueDate: undefined,
    accountId: "",
    note: "",
  };
}

function LoanRepaymentsPanel({ loan }: { loan: ILoan }) {
  const { formatCurrency } = useCurrency();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date());
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const accountOptions = (accounts ?? []).filter(account => account.type !== "credit_card" && !account.isArchived);

  const { data: repayments, isLoading } = useQuery<IRepayment[]>({
    queryKey: ["loans", loan._id, "repayments"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: IRepayment[] }>(`/loans/${loan._id}/repayments`);
      return res.data.data;
    },
  });

  const addRepayment = useMutation({
    mutationFn: () => apiClient.post(`/loans/${loan._id}/repayments`, {
      amount: Math.round(parseFloat(amount) * 100),
      date: date.toISOString(),
      note: note || undefined,
      accountId: accountId || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["loans"] });
      void qc.invalidateQueries({ queryKey: ["loans", loan._id, "repayments"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      setAmount("");
      setNote("");
      toast.success("Repayment added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mt-4 rounded-[var(--r-md)] p-4 flex flex-col gap-3" style={{ background: "var(--card-2)" }}>
      <div className="grid md:grid-cols-4 gap-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="rounded-[var(--r-sm)] px-3 py-2 text-sm outline-none"
          style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
        />
        <DatePickerField
          value={date}
          onChange={(nextDate) => {
            if (nextDate) setDate(nextDate);
          }}
          placeholder="Repayment date"
        />
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-[var(--r-sm)] px-3 py-2 text-sm outline-none"
          style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
        >
          <option value="">No account impact</option>
          {accountOptions.map(account => (
            <option key={String(account._id)} value={String(account._id)}>
              {account.name}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note"
          className="rounded-[var(--r-sm)] px-3 py-2 text-sm outline-none"
          style={{ background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
        />
      </div>
      <button
        onClick={() => addRepayment.mutate()}
        disabled={addRepayment.isPending || !amount}
        className="rounded-[var(--r-sm)] py-2 text-sm font-bold disabled:opacity-50"
        style={{ background: "var(--violet)", color: "#fff" }}
      >
        {addRepayment.isPending ? "Saving..." : "Add repayment"}
      </button>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <Skeleton className="h-12 rounded-[var(--r-sm)]" />
        ) : (repayments ?? []).length === 0 ? (
          <div className="text-sm font-medium" style={{ color: "var(--ink-3)" }}>No repayments yet</div>
        ) : (
          (repayments ?? []).map((repayment) => (
            <div key={String(repayment._id)} className="flex items-center justify-between gap-3 rounded-[var(--r-sm)] px-3 py-2" style={{ background: "var(--card)" }}>
              <div>
                <div className="text-sm font-bold tnum" style={{ color: "var(--ink)" }}>{formatCurrency(repayment.amount)}</div>
                <div className="text-xs" style={{ color: "var(--ink-3)" }}>{format(new Date(repayment.date), "d MMM yyyy")}</div>
              </div>
              {repayment.note && <div className="text-xs text-right" style={{ color: "var(--ink-3)" }}>{repayment.note}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function LoansClient() {
  const { formatCurrency } = useCurrency();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const [tab, setTab] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [openRepayments, setOpenRepayments] = useState<string | null>(null);
  const [form, setForm] = useState<LoanForm>(createEmptyLoanForm);

  const { data: loans, isLoading } = useLoans(tab || undefined);
  const accountOptions = (accounts ?? []).filter(account => account.type !== "credit_card" && !account.isArchived);

  const createLoan = useMutation({
    mutationFn: () => apiClient.post("/loans", {
      ...form,
      principalAmount: Math.round(parseFloat(form.principalAmount) * 100),
      dueDate: form.dueDate?.toISOString(),
      accountId: form.accountId || undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["loans"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      setShowAdd(false);
      setForm(createEmptyLoanForm());
      toast.success("Loan recorded");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLoan = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/loans/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["loans"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Loan deleted");
    },
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Tabs */}
      <div className="flex gap-2.5">
        {TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="rounded-full px-4 py-2 text-[13px] font-semibold transition-all"
            style={
              tab === t.value
                ? { background: "var(--violet)", color: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,.30)" }
                : { background: "var(--card)", color: "var(--ink-2)", boxShadow: "var(--shadow-sm)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 rounded-[var(--r-md)]" />)}
        </div>
      ) : (loans ?? []).length === 0 && !showAdd ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] py-16"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="text-4xl">🤝</div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No loans recorded</p>
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm font-bold px-4 py-2 rounded-full"
            style={{ background: "var(--violet)", color: "#fff" }}
          >
            Record loan
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(loans ?? []).map(loan => {
            const isGiven = loan.direction === "given";
            const Icon = isGiven ? ArrowUpRight : ArrowDownLeft;
            const color = isGiven ? "var(--green)" : "var(--red)";
            const paidPct = loan.principalAmount > 0
              ? ((loan.principalAmount - loan.remainingAmount) / loan.principalAmount) * 100
              : 100;

            return (
              <div
                key={String(loan._id)}
                className="rounded-[var(--r-md)] px-5 py-4"
                style={{
                  background: "var(--card)",
                  boxShadow: "var(--shadow-sm)",
                  opacity: loan.isSettled ? 0.65 : 1,
                }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-11 h-11 rounded-full grid place-items-center flex-none"
                    style={{ background: isGiven ? "rgba(79,192,126,.12)" : "rgba(235,87,87,.12)" }}
                  >
                    <Icon size={20} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm" style={{ color: "var(--ink)" }}>{loan.counterparty}</span>
                      <div className="flex items-center gap-2">
                        {loan.isSettled && (
                          <span
                            className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(79,192,126,.15)", color: "var(--green)" }}
                          >
                            Settled
                          </span>
                        )}
                        <button onClick={() => deleteLoan.mutate(String(loan._id))}>
                          <Trash2 size={13} style={{ color: "var(--ink-3)" }} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[13px] font-bold tnum" style={{ color }}>
                        {isGiven ? "Lent" : "Borrowed"} {formatCurrency(loan.principalAmount)}
                      </span>
                      {!loan.isSettled && (
                        <span className="text-xs font-medium" style={{ color: "var(--ink-3)" }}>
                          {formatCurrency(loan.remainingAmount)} left
                        </span>
                      )}
                    </div>
                    {loan.dueDate && (
                      <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
                        Due {format(new Date(loan.dueDate), "d MMM yyyy")}
                      </div>
                    )}
                    {/* Repayment progress */}
                    {!loan.isSettled && (
                      <div className="mt-2.5">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${paidPct}%`, background: color }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setOpenRepayments((current) => current === String(loan._id) ? null : String(loan._id))}
                  className="inline-flex items-center gap-2 mt-4 rounded-[var(--r-sm)] px-3 py-2 text-sm font-bold"
                  style={{ background: "var(--card-2)", color: "var(--violet)" }}
                >
                  <Receipt size={14} />
                  Repayments
                </button>
                {openRepayments === String(loan._id) && <LoanRepaymentsPanel loan={loan} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div
          className="rounded-[var(--r-lg)] p-5 flex flex-col gap-4"
          style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
        >
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>Record Loan</div>

          {/* Direction toggle */}
          <div className="flex gap-2 rounded-full p-1" style={{ background: "var(--card-2)" }}>
            {(["received", "given"] as const).map(d => (
              <button
                key={d}
                onClick={() => setForm(f => ({ ...f, direction: d }))}
                className="flex-1 py-2 rounded-full text-sm font-bold capitalize"
                style={
                  form.direction === d
                    ? { background: d === "given" ? "var(--green)" : "var(--red)", color: "#fff" }
                    : { color: "var(--ink-2)" }
                }
              >
                {d === "given" ? "I lent" : "I borrowed"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                {form.direction === "given" ? "Lent to" : "Borrowed from"}
              </label>
              <input
                value={form.counterparty}
                onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))}
                placeholder="Name"
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.principalAmount}
                onChange={e => setForm(f => ({ ...f, principalAmount: e.target.value }))}
                placeholder="0.00"
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <DatePickerField
                label="Due date"
                value={form.dueDate}
                onChange={(dueDate) => setForm(f => ({ ...f, dueDate }))}
                clearable
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Account impact</label>
              <select
                value={form.accountId}
                onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
                className="rounded-[var(--r-sm)] px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
              >
                <option value="">Track loan only</option>
                {accountOptions.map(account => (
                  <option key={String(account._id)} value={String(account._id)}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => createLoan.mutate()}
              disabled={createLoan.isPending || !form.counterparty || !form.principalAmount}
              className="flex-1 py-2.5 rounded-[var(--r-sm)] text-sm font-bold"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              {createLoan.isPending ? "Saving..." : "Save"}
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

      {!showAdd && (loans ?? []).length > 0 && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center justify-center gap-2 rounded-[var(--r-md)] py-3.5 text-sm font-bold"
          style={{ background: "var(--card)", color: "var(--violet)", boxShadow: "var(--shadow-sm)" }}
        >
          <Plus size={17} />
          Record Loan
        </button>
      )}
    </div>
  );
}
