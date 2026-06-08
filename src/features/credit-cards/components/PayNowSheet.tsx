"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, CreditCard } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { useCurrency } from "@/hooks/useCurrency";
import { type ICreditStatement, type IAccount } from "@/types/models";
import { computeMinPayment } from "@/lib/credit-card";
import { dollarsToCents } from "@/lib/utils";
import apiClient from "@/lib/api-client";
import { DatePickerField } from "@/components/shared/DatePickerField";

interface PayNowSheetProps {
  statement: ICreditStatement;
  account: IAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AmountMode = "full" | "minimum" | "custom";

export function PayNowSheet({ statement, account, open, onOpenChange }: PayNowSheetProps) {
  const { formatCurrency } = useCurrency();
  const { data: allAccounts } = useAccounts();
  const qc = useQueryClient();

  const statementBalance = statement.balance ?? 0;
  const balance = Math.max(0, statementBalance - (statement.paidAmount ?? 0));
  const minPayment = Math.min(balance, computeMinPayment(balance, account.creditMeta?.minPaymentPct ?? 2));

  const [mode, setMode] = React.useState<AmountMode>("full");
  const [customAmount, setCustomAmount] = React.useState("");
  const [sourceAccountId, setSourceAccountId] = React.useState("");
  const [payDate, setPayDate] = React.useState<Date | undefined>(new Date());

  const sourceAccounts = (allAccounts ?? []).filter(
    a => a.type !== "credit_card" && !a.isArchived && String(a._id) !== String(account._id)
  );

  React.useEffect(() => {
    if (sourceAccounts.length > 0 && !sourceAccountId) {
      setSourceAccountId(String(sourceAccounts[0]._id));
    }
  }, [sourceAccounts.length]);

  const payAmount = (() => {
    if (mode === "full") return balance;
    if (mode === "minimum") return minPayment;
    const parsed = parseFloat(customAmount);
    return isNaN(parsed) ? 0 : dollarsToCents(parsed);
  })();

  const createTransactionAndPay = useMutation({
    mutationFn: async () => {
      if (!sourceAccountId) throw new Error("Select a source account");
      if (payAmount <= 0) throw new Error("Amount must be greater than zero");

      // Create transfer transaction: from bank → credit card
      const txRes = await apiClient.post<{ data: { _id: string } }>("/transactions", {
        accountId: sourceAccountId,
        type: "transfer",
        amount: payAmount,
        currency: account.currency ?? "USD",
        category: "Transfer",
        description: `Payment to ${account.name}`,
        date: (payDate ?? new Date()).toISOString(),
        transferToId: String(account._id),
        tags: [],
        isRecurring: false,
      });

      const txId = txRes.data.data._id;

      // Mark statement as paid
      await apiClient.patch(
        `/credit-cards/${String(account._id)}/statements/${String(statement._id)}`,
        {
          paidAmount: payAmount,
          paidAt: (payDate ?? new Date()).toISOString(),
          paymentTransactionId: txId,
        }
      );

      return txId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["credit-statements", String(account._id)] });
      void qc.invalidateQueries({ queryKey: ["credit-summary"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Payment recorded successfully");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-[var(--r-lg)] border-x border-t p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom md:inset-x-auto md:inset-y-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[400px] md:rounded-[var(--r-lg)] md:border"
          style={{ background: "var(--card)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderColor: "var(--line)", color: "var(--ink)" }}
        >
          {/* Header */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <Dialog.Title className="text-sm font-extrabold" style={{ color: "var(--ink)" }}>Pay Statement</Dialog.Title>
              <Dialog.Description className="text-[11px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
                {format(new Date(statement.periodEnd), "MMMM yyyy")} · {account.name}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-9 place-items-center rounded-full"
              style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* Balance summary */}
          <div className="rounded-[var(--r-md)] p-3.5 mb-4" style={{ background: "var(--card-2)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Remaining Balance</span>
              <span className="text-[18px] font-extrabold tnum" style={{ color: "var(--red)" }}>{formatCurrency(balance)}</span>
            </div>
            {statement.paidAmount > 0 && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>Already paid</span>
                <span className="text-[13px] font-bold tnum" style={{ color: "var(--green)" }}>{formatCurrency(statement.paidAmount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>Minimum payment</span>
              <span className="text-[13px] font-bold tnum" style={{ color: "var(--ink-2)" }}>{formatCurrency(minPayment)}</span>
            </div>
          </div>

          {/* Amount mode */}
          <div className="flex flex-col gap-2 mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Amount</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "full" as AmountMode, label: "Full Balance", value: balance },
                { key: "minimum" as AmountMode, label: "Minimum", value: minPayment },
                { key: "custom" as AmountMode, label: "Custom", value: null },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMode(opt.key)}
                  className="flex flex-col gap-0.5 rounded-[var(--r-sm)] px-3 py-2.5 text-left transition-all"
                  style={{
                    background: mode === opt.key ? "var(--violet)" : "var(--card-2)",
                    color: mode === opt.key ? "#fff" : "var(--ink)",
                  }}
                >
                  <span className="text-[10px] font-bold opacity-70">{opt.label}</span>
                  {opt.value !== null && (
                    <span className="text-[13px] font-extrabold tnum">{formatCurrency(opt.value)}</span>
                  )}
                  {opt.value === null && <span className="text-[13px] font-extrabold">—</span>}
                </button>
              ))}
            </div>

            {mode === "custom" && (
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Enter amount"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
                autoFocus
              />
            )}
          </div>

          {/* Source account */}
          <div className="flex flex-col gap-1.5 mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Pay From</div>
            <select
              value={sourceAccountId}
              onChange={e => setSourceAccountId(e.target.value)}
              className="rounded-(--r-sm) px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--card-2)", color: "var(--ink)", border: "1.5px solid var(--line)" }}
            >
              {sourceAccounts.length === 0 && <option value="">No eligible accounts</option>}
              {sourceAccounts.map(a => (
                <option key={String(a._id)} value={String(a._id)}>
                  {a.name} — {a.currency}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="mb-5">
            <DatePickerField
              label="Payment Date"
              value={payDate}
              onChange={setPayDate}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => createTransactionAndPay.mutate()}
              disabled={createTransactionAndPay.isPending || !sourceAccountId || payAmount <= 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-[var(--r-sm)] text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--violet)", color: "#fff" }}
            >
              <CreditCard size={15} />
              {createTransactionAndPay.isPending ? "Processing..." : `Pay ${formatCurrency(payAmount)}`}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-5 py-3 rounded-[var(--r-sm)] text-sm font-bold"
              style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            >
              Cancel
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
