"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowDownLeft, ArrowUpRight, Trash2, Receipt, Pencil, Save, Handshake } from "lucide-react";
import { format } from "date-fns";
import apiClient from "@/lib/api-client";
import { useCurrency } from "@/hooks/useCurrency";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { type ILoan, type IRepayment } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Progress } from "@/components/_ui/Progress";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/_ui/Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "sonner";
import { invalidateForResource } from "@/lib/realtime/invalidation";

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
  interestRate: string;
  startDate: string;
  dueDate?: Date;
  accountId: string;
  note: string;
  externalLoanId: string;
}

function createEmptyLoanForm(): LoanForm {
  return {
    direction: "received",
    counterparty: "",
    principalAmount: "",
    interestRate: "",
    startDate: format(new Date(), "yyyy-MM-dd"),
    dueDate: undefined,
    accountId: "",
    note: "",
    externalLoanId: "",
  };
}

// Editable fields per the API's PATCH /api/loans/[id] schema — principalAmount
// is deliberately not editable here (it would desync repayment math already
// recorded against the original principal).
interface LoanEditForm {
  counterparty: string;
  dueDate?: Date;
  isSettled: boolean;
  description: string;
  interestRate: string;
  externalLoanId: string;
}

function LoanEditPanel({ loan, onDone }: { loan: ILoan; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<LoanEditForm>({
    counterparty: loan.counterparty,
    dueDate: loan.dueDate ? new Date(loan.dueDate) : undefined,
    isSettled: loan.isSettled,
    description: loan.description ?? "",
    interestRate: loan.interestRate ? String(loan.interestRate) : "",
    externalLoanId: loan.externalLoanId ?? "",
  });

  const updateLoan = useMutation({
    mutationFn: () => apiClient.patch(`/loans/${loan._id}`, {
      counterparty: form.counterparty,
      dueDate: form.dueDate?.toISOString(),
      isSettled: form.isSettled,
      description: form.description || undefined,
      interestRate: form.interestRate ? parseFloat(form.interestRate) : undefined,
      externalLoanId: form.externalLoanId || undefined,
    }),
    onSuccess: () => {
      invalidateForResource(qc, "loans");
      toast.success("Loan updated");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card surface="card-2" radius="md" className="p-4 flex flex-col gap-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="loans-client-name-1" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Name</Label>
          <Input id="loans-client-name-1" value={form.counterparty} onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))} />
        </div>
        <DatePickerField
          label="Due date"
          value={form.dueDate}
          onChange={(dueDate) => setForm((f) => ({ ...f, dueDate }))}
          clearable
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="loans-client-interest-rate-p-a-optional-2" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Interest rate (% p.a., optional)</Label>
          <Input id="loans-client-interest-rate-p-a-optional-2" type="number" min="0" max="100" step="0.01" value={form.interestRate} onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value }))} placeholder="0" />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="loans-client-note-3" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Note</Label>
          <Input id="loans-client-note-3" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional note" />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="loans-client-loan-account-number-optional-4" className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>Loan account number (optional)</Label>
          <Input id="loans-client-loan-account-number-optional-4"
            value={form.externalLoanId}
            onChange={(e) => setForm((f) => ({ ...f, externalLoanId: e.target.value }))}
            placeholder="e.g. 010021753351"
          />
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>
            Matches EMI payment SMS/messages to this loan automatically.
          </p>
        </div>
        <Label className="flex items-center justify-between gap-3 cursor-pointer md:col-span-2">
          <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>Mark as settled</span>
          <Switch checked={form.isSettled} onCheckedChange={(v) => setForm((f) => ({ ...f, isSettled: v }))} />
        </Label>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => updateLoan.mutate()}
          disabled={updateLoan.isPending || !form.counterparty}
          className="h-11 rounded-full px-5 font-semibold btn-interactive"
        >
          <Save size={14} />
          {updateLoan.isPending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} className="h-11 rounded-full px-5 font-semibold">
          Cancel
        </Button>
      </div>
    </Card>
  );
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
      invalidateForResource(qc, "loans");
      invalidateForResource(qc, "transactions");
      void qc.invalidateQueries({ queryKey: ["loans", loan._id, "repayments"] });
      setAmount("");
      setNote("");
      toast.success("Repayment added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card surface="card-2" radius="md" className="p-4 flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
        />
        <DatePickerField
          value={date}
          onChange={(nextDate) => {
            if (nextDate) setDate(nextDate);
          }}
          placeholder="Repayment date"
        />
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger>
            <SelectValue placeholder="No account impact" />
          </SelectTrigger>
          <SelectContent>
            {accountOptions.map(account => (
              <SelectItem key={String(account._id)} value={String(account._id)}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
      </div>
      <Button
        onClick={() => addRepayment.mutate()}
        disabled={addRepayment.isPending || !amount}
        className="h-11 rounded-full font-semibold btn-interactive"
      >
        {addRepayment.isPending ? "Saving..." : "Add repayment"}
      </Button>

      {isLoading ? (
        <Skeleton className="h-12 rounded-(--r-sm)" />
      ) : (repayments ?? []).length === 0 ? (
        <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>No repayments yet</div>
      ) : (
        <div className="inset-group" style={{ "--inset": "16px" } as React.CSSProperties}>
          {(repayments ?? []).map((repayment) => (
            <div key={String(repayment._id)} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink)" }}>{formatCurrency(repayment.amount)}</div>
                <div style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>{format(new Date(repayment.date), "d MMM yyyy")}</div>
              </div>
              {repayment.note && <div className="text-right truncate" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{repayment.note}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function LoansClient() {
  const { formatCurrency } = useCurrency();
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const { confirm, dialog } = useConfirm();
  const [tab, setTab] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [openRepayments, setOpenRepayments] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LoanForm>(createEmptyLoanForm);

  const { data: loans, isLoading } = useLoans(tab || undefined);
  const accountOptions = (accounts ?? []).filter(account => account.type !== "credit_card" && !account.isArchived);

  const createLoan = useMutation({
    mutationFn: () => apiClient.post("/loans", {
      ...form,
      principalAmount: Math.round(parseFloat(form.principalAmount) * 100),
      interestRate: form.interestRate ? parseFloat(form.interestRate) : undefined,
      dueDate: form.dueDate?.toISOString(),
      accountId: form.accountId || undefined,
      externalLoanId: form.externalLoanId || undefined,
    }),
    onSuccess: () => {
      invalidateForResource(qc, "loans");
      invalidateForResource(qc, "transactions");
      setShowAdd(false);
      setForm(createEmptyLoanForm());
      toast.success("Loan recorded");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteLoan = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/loans/${id}`),
    onSuccess: () => {
      invalidateForResource(qc, "loans");
      invalidateForResource(qc, "transactions");
      toast.success("Loan deleted");
    },
  });

  const requestDelete = async (loan: ILoan) => {
    const ok = await confirm({
      title: `Delete this loan with ${loan.counterparty}?`,
      description: "This can't be undone. Any linked repayments and account impact stay as past transactions.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) deleteLoan.mutate(String(loan._id));
  };

  const loanList = loans ?? [];
  const active = loanList.filter(l => !l.isSettled);
  const totalLent = active.filter(l => l.direction === "given").reduce((n, l) => n + l.remainingAmount, 0);
  const totalBorrowed = active.filter(l => l.direction === "received").reduce((n, l) => n + l.remainingAmount, 0);
  const net = totalLent - totalBorrowed;
  const counterpartyMissing = form.counterparty.trim() === "";
  const amountInvalid = !form.principalAmount || !(parseFloat(form.principalAmount) > 0);
  const closeAdd = () => { setShowAdd(false); setForm(createEmptyLoanForm()); };
  const labelStyle = { font: "var(--text-label)", color: "var(--ink-2)" } as const;

  return (
    <div className="page-stack">
      <PageHeader
        title="Loans"
        subtitle="Money lent and borrowed, with repayments tracked."
        actions={
          <Button type="button" onClick={() => setShowAdd(true)} className="h-11 px-5 rounded-full font-semibold btn-interactive">
            <Plus size={16} />
            Record loan
          </Button>
        }
      />

      {!isLoading && loanList.length > 0 && (
        <div className="grid-cards" style={{ "--card-min": "220px" } as React.CSSProperties}>
          {[
            { label: "Owed to you", value: totalLent, color: "var(--green)" },
            { label: "You owe", value: totalBorrowed, color: totalBorrowed > 0 ? "var(--red)" : "var(--ink)" },
            { label: "Net position", value: net, color: net < 0 ? "var(--red)" : "var(--ink)" },
          ].map(st => (
            <Card key={st.label} radius="lg" className="p-5 min-w-0">
              <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{st.label}</div>
              <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: st.color }}>{formatCurrency(st.value)}</div>
            </Card>
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-10 w-max p-1 rounded-full" style={{ background: "var(--card-2)" }}>
          {TABS.map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-8 px-4 rounded-full border-0 shadow-none data-[state=active]:shadow-(--shadow-sm) active:scale-[0.97] transition"
              style={{
                font: "var(--text-label)",
                fontWeight: 600,
                background: tab === t.value ? "var(--card)" : "transparent",
                color: tab === t.value ? "var(--ink)" : "var(--ink-2)",
              }}
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid-cards" style={{ "--card-min": "340px" } as React.CSSProperties}>
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-44 rounded-(--r-lg)" />)}
        </div>
      ) : loanList.length === 0 ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-20 text-center px-6">
          <div className="w-14 h-14 rounded-2xl grid place-items-center" style={{ background: "var(--card-2)" }}>
            <Handshake size={26} style={{ color: "var(--ink-2)" }} />
          </div>
          <p style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>No loans recorded</p>
          <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Track money you lend or borrow.</p>
          <Button onClick={() => setShowAdd(true)} className="h-11 px-5 rounded-full font-semibold btn-interactive">Record loan</Button>
        </Card>
      ) : (
        <div className="grid-cards items-start" style={{ "--card-min": "340px" } as React.CSSProperties}>
          {loanList.map(loan => {
            const isGiven = loan.direction === "given";
            const Icon = isGiven ? ArrowUpRight : ArrowDownLeft;
            const color = isGiven ? "var(--green)" : "var(--red)";
            const paid = loan.principalAmount - loan.remainingAmount;
            const paidPct = loan.principalAmount > 0 ? (paid / loan.principalAmount) * 100 : 100;
            const id = String(loan._id);
            const editing = editingId === id;

            return (
              <Card key={id} radius="lg" className="p-5 flex flex-col gap-4 min-w-0" style={{ opacity: loan.isSettled ? 0.7 : 1 }}>
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className="w-11 h-11 rounded-full grid place-items-center flex-none"
                    style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
                  >
                    <Icon size={20} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{loan.counterparty}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                      <span>{isGiven ? "You lent" : "You borrowed"}</span>
                      {!!loan.interestRate && <span className="tnum">· {loan.interestRate}% p.a.</span>}
                      {loan.dueDate && <span>· Due {format(new Date(loan.dueDate), "d MMM yyyy")}</span>}
                      {loan.isSettled && (
                        <span className="rounded-full px-2 py-0.5" style={{ background: "color-mix(in srgb, var(--green) 15%, transparent)", color: "var(--green)" }}>Settled</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center flex-none -mr-1.5">
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full"
                      aria-label={editing ? `Close ${loan.counterparty} loan editor` : `Edit loan with ${loan.counterparty}`}
                      onClick={() => setEditingId(editing ? null : id)}>
                      <Pencil size={13} style={{ color: "var(--ink-3)" }} />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full"
                      aria-label={`Delete loan with ${loan.counterparty}`}
                      onClick={() => requestDelete(loan)}>
                      <Trash2 size={13} style={{ color: "var(--ink-3)" }} />
                    </Button>
                  </div>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="tnum truncate" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: loan.isSettled ? "var(--ink-2)" : color }}>
                      {formatCurrency(loan.isSettled ? loan.principalAmount : loan.remainingAmount)}
                    </div>
                    <div className="tnum mt-1" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
                      {loan.isSettled ? "paid in full" : `left of ${formatCurrency(loan.principalAmount)}`}
                    </div>
                  </div>
                  {!loan.isSettled && <div className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--ink-2)" }}>{Math.round(paidPct)}%</div>}
                </div>

                {!loan.isSettled && (
                  <Progress value={paidPct} color={color} trackColor="var(--line)" height={6} aria-label={`${loan.counterparty} repayment progress`} />
                )}

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpenRepayments((current) => current === id ? null : id)}
                  aria-expanded={openRepayments === id}
                  className="h-11 inline-flex items-center justify-center gap-2 rounded-full px-4 font-semibold btn-interactive"
                >
                  <Receipt size={14} />
                  Repayments
                </Button>
                {openRepayments === id && <LoanRepaymentsPanel loan={loan} />}
                {editing && <LoanEditPanel loan={loan} onDone={() => setEditingId(null)} />}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) closeAdd(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 gap-0 border-0 sm:max-w-lg" style={{ background: "var(--card)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)" }}>
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>Record loan</DialogTitle>
            <DialogDescription style={{ color: "var(--ink-3)" }}>Who, how much, and whether an account is affected.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5 px-6 pb-6 pt-3"
            onSubmit={(e) => { e.preventDefault(); if (!counterpartyMissing && !amountInvalid) createLoan.mutate(); }}
          >
            <div className="flex gap-1 rounded-full p-1" style={{ background: "var(--card-2)" }} role="group" aria-label="Loan direction">
              {(["received", "given"] as const).map(d => (
                <Button
                  key={d}
                  type="button"
                  variant="ghost"
                  aria-pressed={form.direction === d}
                  onClick={() => setForm(f => ({ ...f, direction: d }))}
                  className="flex-1 h-9 rounded-full font-semibold active:scale-[0.97] transition"
                  style={
                    form.direction === d
                      ? { background: "var(--card)", color: d === "given" ? "var(--green)" : "var(--red)", boxShadow: "var(--shadow-sm)" }
                      : { color: "var(--ink-2)" }
                  }
                >
                  {d === "given" ? "I lent" : "I borrowed"}
                </Button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="loan-counterparty" style={labelStyle}>
                {form.direction === "given" ? "Lent to" : "Borrowed from"}
              </Label>
              <Input
                id="loan-counterparty"
                value={form.counterparty}
                onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))}
                placeholder="Name"
                autoFocus
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="loans-client-amount-5" style={labelStyle}>Amount</Label>
                <Input id="loans-client-amount-5"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.principalAmount}
                  onChange={e => setForm(f => ({ ...f, principalAmount: e.target.value }))}
                  placeholder="0.00"
                  className="h-11"
                />
                {form.principalAmount !== "" && amountInvalid && <span style={{ font: "var(--text-micro)", color: "var(--red)" }}>Enter an amount above zero</span>}
              </div>
              <DatePickerField
                label="Due date"
                value={form.dueDate}
                onChange={(dueDate) => setForm(f => ({ ...f, dueDate }))}
                clearable
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="loans-client-interest-rate-p-a-optional-6" style={labelStyle}>Interest (% p.a., optional)</Label>
                <Input id="loans-client-interest-rate-p-a-optional-6"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.interestRate}
                  onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))}
                  placeholder="0"
                  className="h-11"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="loan-account-impact" style={labelStyle}>Account impact</Label>
                <Select value={form.accountId} onValueChange={(value) => setForm(f => ({ ...f, accountId: value }))}>
                  <SelectTrigger id="loan-account-impact" className="h-11 w-full">
                    <SelectValue placeholder="Track loan only" />
                  </SelectTrigger>
                  <SelectContent>
                    {accountOptions.map(account => (
                      <SelectItem key={String(account._id)} value={String(account._id)}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.direction === "received" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="loans-client-loan-account-number-optional-7" style={labelStyle}>Loan account number (optional)</Label>
                <Input id="loans-client-loan-account-number-optional-7"
                  value={form.externalLoanId}
                  onChange={e => setForm(f => ({ ...f, externalLoanId: e.target.value }))}
                  placeholder="e.g. 010021753351"
                  className="h-11"
                />
                <p style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                  Matches EMI payment SMS/messages to this loan automatically.
                </p>
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
              <Button type="button" variant="ghost" onClick={closeAdd} className="h-11 px-5 rounded-full font-semibold">Cancel</Button>
              <Button type="submit" disabled={createLoan.isPending || counterpartyMissing || amountInvalid} className="h-11 px-6 rounded-full font-semibold btn-interactive">
                {createLoan.isPending ? "Saving..." : "Save loan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
