"use client";

import * as React from "react";
import { CreditCard } from "lucide-react";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

  const statementBalance = statement.statementBalance ?? statement.balance ?? 0;
  const balance = statement.remainingDue ?? Math.max(0, statementBalance - (statement.paidAmount ?? 0));
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

      // Server creates the linked transfer and updates the statement together.
      await apiClient.patch(
        `/credit-cards/${String(account._id)}/statements/${String(statement._id)}`,
        {
          paidAmount: payAmount,
          paidAt: (payDate ?? new Date()).toISOString(),
          sourceAccountId,
        }
      );
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-(--r-lg) p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:inset-x-auto md:inset-y-auto md:left-1/2 md:top-1/2 md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2 md:w-100 md:rounded-(--r-lg) md:border"
        style={{ background: "var(--card)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderColor: "var(--line)", color: "var(--ink)" }}
      >
        <SheetHeader className="text-left space-y-0.5">
          <SheetTitle className="text-sm font-extrabold" style={{ color: "var(--ink)" }}>Pay Statement</SheetTitle>
          <SheetDescription className="text-[11px] font-medium" style={{ color: "var(--ink-3)" }}>
            {format(new Date(statement.periodEnd), "MMMM yyyy")} · {account.name}
          </SheetDescription>
        </SheetHeader>

        {/* Balance summary */}
        <Card surface="card-2" radius="md" className="p-3.5 mt-4 mb-4">
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
        </Card>

        {/* Amount mode */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Amount</div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: "full" as AmountMode, label: "Full Balance", value: balance },
              { key: "minimum" as AmountMode, label: "Minimum", value: minPayment },
              { key: "custom" as AmountMode, label: "Custom", value: null },
            ] as const).map(opt => (
              <Button
                key={opt.key}
                type="button"
                variant="ghost"
                onClick={() => setMode(opt.key)}
                className="h-auto flex-col items-start gap-0.5 rounded-(--r-sm) px-3 py-2.5 text-left"
                style={{
                  background: mode === opt.key ? "var(--violet)" : "var(--card-2)",
                  color: mode === opt.key ? "var(--violet-fg)" : "var(--ink)",
                }}
              >
                <span className="text-[10px] font-bold opacity-70">{opt.label}</span>
                {opt.value !== null && (
                  <span className="text-[13px] font-extrabold tnum">{formatCurrency(opt.value)}</span>
                )}
                {opt.value === null && <span className="text-[13px] font-extrabold">—</span>}
              </Button>
            ))}
          </div>

          {mode === "custom" && (
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Enter amount"
              value={customAmount}
              onChange={e => setCustomAmount(e.target.value)}
              autoFocus
            />
          )}
        </div>

        {/* Source account */}
        <div className="flex flex-col gap-1.5 mb-4">
          <Label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>Pay From</Label>
          <Select value={sourceAccountId} onValueChange={setSourceAccountId} disabled={sourceAccounts.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder="No eligible accounts" />
            </SelectTrigger>
            <SelectContent>
              {sourceAccounts.map(a => (
                <SelectItem key={String(a._id)} value={String(a._id)}>
                  {a.name} — {a.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Button
            type="button"
            onClick={() => createTransactionAndPay.mutate()}
            disabled={createTransactionAndPay.isPending || !sourceAccountId || payAmount <= 0}
            className="flex-1 h-auto py-3 rounded-(--r-sm) font-bold"
          >
            <CreditCard size={15} />
            {createTransactionAndPay.isPending ? "Processing..." : `Pay ${formatCurrency(payAmount)}`}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="h-auto px-5 py-3 rounded-(--r-sm) font-bold"
          >
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
