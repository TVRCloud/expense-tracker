"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowDownLeft, ArrowUpRight, Trash2, Receipt, Pencil, Save } from "lucide-react";
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
      void qc.invalidateQueries({ queryKey: ["loans"] });
      toast.success("Loan updated");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card surface="card-2" radius="md" className="mt-4 p-4 flex flex-col gap-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Name</Label>
          <Input value={form.counterparty} onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))} />
        </div>
        <DatePickerField
          label="Due date"
          value={form.dueDate}
          onChange={(dueDate) => setForm((f) => ({ ...f, dueDate }))}
          clearable
        />
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Interest rate (% p.a., optional)</Label>
          <Input type="number" min="0" max="100" step="0.01" value={form.interestRate} onChange={(e) => setForm((f) => ({ ...f, interestRate: e.target.value }))} placeholder="0" />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Note</Label>
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional note" />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Loan account number (optional)</Label>
          <Input
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
          className="h-auto rounded-(--r-sm) px-3 py-2 font-bold"
        >
          <Save size={14} />
          {updateLoan.isPending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} className="h-auto rounded-(--r-sm) px-3 py-2 font-bold">
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
    <Card surface="card-2" radius="md" className="mt-4 p-4 flex flex-col gap-3">
      <div className="grid md:grid-cols-4 gap-2">
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
        className="h-auto py-2 rounded-(--r-sm) font-bold"
      >
        {addRepayment.isPending ? "Saving..." : "Add repayment"}
      </Button>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <Skeleton className="h-12 rounded-(--r-sm)" />
        ) : (repayments ?? []).length === 0 ? (
          <div className="text-sm font-medium" style={{ color: "var(--ink-3)" }}>No repayments yet</div>
        ) : (
          (repayments ?? []).map((repayment) => (
            <div key={String(repayment._id)} className="flex items-center justify-between gap-3 rounded-(--r-sm) px-3 py-2" style={{ background: "var(--card)" }}>
              <div>
                <div className="text-sm font-bold tnum" style={{ color: "var(--ink)" }}>{formatCurrency(repayment.amount)}</div>
                <div className="text-xs" style={{ color: "var(--ink-3)" }}>{format(new Date(repayment.date), "d MMM yyyy")}</div>
              </div>
              {repayment.note && <div className="text-xs text-right" style={{ color: "var(--ink-3)" }}>{repayment.note}</div>}
            </div>
          ))
        )}
      </div>
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

  const requestDelete = async (loan: ILoan) => {
    const ok = await confirm({
      title: `Delete this loan with ${loan.counterparty}?`,
      description: "This can't be undone. Any linked repayments and account impact stay as past transactions.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) deleteLoan.mutate(String(loan._id));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-max bg-transparent p-0 gap-2.5">
          {TABS.map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-auto px-4 py-2 rounded-full text-[13px] font-semibold"
              style={
                tab === t.value
                  ? { background: "var(--violet)", color: "var(--violet-fg)", boxShadow: "0 4px 14px rgba(0,0,0,.30)" }
                  : { background: "var(--card)", color: "var(--ink-2)", boxShadow: "var(--shadow-sm)" }
              }
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 rounded-(--r-md)" />)}
        </div>
      ) : (loans ?? []).length === 0 && !showAdd ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-16">
          <div className="text-4xl">🤝</div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No loans recorded</p>
          <Button onClick={() => setShowAdd(true)} className="h-auto text-sm px-4 py-2 rounded-full">
            Record loan
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(loans ?? []).map(loan => {
            const isGiven = loan.direction === "given";
            const Icon = isGiven ? ArrowUpRight : ArrowDownLeft;
            const color = isGiven ? "var(--green)" : "var(--red)";
            const paidPct = loan.principalAmount > 0
              ? ((loan.principalAmount - loan.remainingAmount) / loan.principalAmount) * 100
              : 100;
            const editing = editingId === String(loan._id);

            return (
              <Card key={String(loan._id)} radius="md" className="px-5 py-4" style={{ opacity: loan.isSettled ? 0.65 : 1 }}>
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
                      <div className="flex items-center gap-1">
                        {loan.isSettled && (
                          <span
                            className="text-[11px] font-bold px-2 py-0.5 rounded-full mr-1"
                            style={{ background: "rgba(79,192,126,.15)", color: "var(--green)" }}
                          >
                            Settled
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={editing ? `Close ${loan.counterparty} loan editor` : `Edit loan with ${loan.counterparty}`}
                          onClick={() => setEditingId(editing ? null : String(loan._id))}
                        >
                          <Pencil size={13} style={{ color: "var(--ink-3)" }} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Delete loan with ${loan.counterparty}`}
                          onClick={() => requestDelete(loan)}
                        >
                          <Trash2 size={13} style={{ color: "var(--ink-3)" }} />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-[13px] font-bold tnum" style={{ color }}>
                        {isGiven ? "Lent" : "Borrowed"} {formatCurrency(loan.principalAmount)}
                      </span>
                      {!loan.isSettled && (
                        <span className="text-xs font-medium" style={{ color: "var(--ink-3)" }}>
                          {formatCurrency(loan.remainingAmount)} left
                        </span>
                      )}
                      {!!loan.interestRate && (
                        <span className="text-xs font-medium" style={{ color: "var(--ink-3)" }}>
                          {loan.interestRate}% p.a.
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
                        <Progress value={paidPct} color={color} trackColor="var(--line)" height={6} />
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpenRepayments((current) => current === String(loan._id) ? null : String(loan._id))}
                  className="h-auto inline-flex items-center gap-2 mt-4 rounded-(--r-sm) px-3 py-2 font-bold"
                  style={{ color: "var(--violet)" }}
                >
                  <Receipt size={14} />
                  Repayments
                </Button>
                {openRepayments === String(loan._id) && <LoanRepaymentsPanel loan={loan} />}
                {editing && <LoanEditPanel loan={loan} onDone={() => setEditingId(null)} />}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <Card radius="lg" elevation="floating" className="p-5 flex flex-col gap-4">
          <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>Record Loan</div>

          {/* Direction toggle */}
          <div className="flex gap-2 rounded-full p-1" style={{ background: "var(--card-2)" }}>
            {(["received", "given"] as const).map(d => (
              <Button
                key={d}
                type="button"
                variant="ghost"
                onClick={() => setForm(f => ({ ...f, direction: d }))}
                className="flex-1 h-auto py-2 rounded-full font-bold capitalize"
                style={
                  form.direction === d
                    ? { background: d === "given" ? "var(--green)" : "var(--red)", color: "#fff" }
                    : { color: "var(--ink-2)" }
                }
              >
                {d === "given" ? "I lent" : "I borrowed"}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
                {form.direction === "given" ? "Lent to" : "Borrowed from"}
              </Label>
              <Input
                value={form.counterparty}
                onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))}
                placeholder="Name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.principalAmount}
                onChange={e => setForm(f => ({ ...f, principalAmount: e.target.value }))}
                placeholder="0.00"
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
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Interest rate (% p.a., optional)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.interestRate}
                onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))}
                placeholder="0"
              />
            </div>
            {form.direction === "received" && (
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Loan account number (optional)</Label>
                <Input
                  value={form.externalLoanId}
                  onChange={e => setForm(f => ({ ...f, externalLoanId: e.target.value }))}
                  placeholder="e.g. 010021753351"
                />
                <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                  Matches EMI payment SMS/messages to this loan automatically.
                </p>
              </div>
            )}
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Account impact</Label>
              <Select value={form.accountId} onValueChange={(value) => setForm(f => ({ ...f, accountId: value }))}>
                <SelectTrigger>
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
          <div className="flex gap-3">
            <Button
              onClick={() => createLoan.mutate()}
              disabled={createLoan.isPending || !form.counterparty || !form.principalAmount}
              className="flex-1 h-auto py-2.5 rounded-(--r-sm) font-bold"
            >
              {createLoan.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAdd(false)}
              className="h-auto px-5 py-2.5 rounded-(--r-sm) font-bold"
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {!showAdd && (loans ?? []).length > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowAdd(true)}
          className="h-auto flex items-center justify-center gap-2 rounded-(--r-md) py-3.5 font-bold"
          style={{ color: "var(--violet)" }}
        >
          <Plus size={17} />
          Record Loan
        </Button>
      )}
      {dialog}
    </div>
  );
}
