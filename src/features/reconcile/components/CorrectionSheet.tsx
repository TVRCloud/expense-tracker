"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Copy, Save } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { DatePickerField } from "@/components/shared/DatePickerField";
import { useCurrency } from "@/hooks/useCurrency";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { CATEGORIES } from "@/features/transactions/components/AddTransactionForm";
import {
  CORRECTION_REASONS,
  useCorrectTransaction,
  type CorrectionChanges,
  type SourceInfo,
  type TxnView,
} from "@/features/reconcile/hooks/useReconcile";
import { SourceBanner } from "./SourceBadge";

// "Something's wrong" for an auto-captured transaction: edit the values,
// pick why, see the balance change before saving. Saving keeps the old
// values as a permanent correction record (src/lib/reconcile/correct.ts).

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TxnView;
  sourceInfo?: SourceInfo;
  rawText?: string | null;
};

function fieldLabel(text: string) {
  return (
    <Label className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>{text}</Label>
  );
}

const effect = (type: string, amount: number) => (type === "income" ? amount : -amount);

export function CorrectionSheet({ open, onOpenChange, transaction, sourceInfo, rawText }: Props) {
  const { formatCurrency } = useCurrency();
  const { data: accounts } = useAccounts();
  const correct = useCorrectTransaction();
  const { confirm, dialog } = useConfirm();

  const initial = useMemo(
    () => ({
      amount: (transaction.amount / 100).toFixed(2),
      type: transaction.type === "income" ? "income" : "expense",
      accountId: transaction.accountId,
      category: transaction.category,
      description: transaction.description,
      date: new Date(transaction.date),
    }),
    [transaction]
  );
  const [form, setForm] = useState(initial);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setForm(initial);
      setReason("");
      setNote("");
    }
  }, [open, initial]);

  const amountMinor = Math.round(Number.parseFloat(form.amount || "0") * 100);
  const validAmount = Number.isFinite(amountMinor) && amountMinor > 0;

  const changes: CorrectionChanges = {};
  if (validAmount && amountMinor !== transaction.amount) changes.amount = amountMinor;
  if (form.type !== transaction.type) changes.type = form.type as "income" | "expense";
  if (form.accountId !== transaction.accountId) changes.accountId = form.accountId;
  if (form.category !== transaction.category) changes.category = form.category;
  if ((form.description ?? "") !== (transaction.description ?? "")) changes.description = form.description;
  if (form.date.getTime() !== new Date(transaction.date).getTime()) changes.date = form.date.toISOString();
  const hasChanges = Object.keys(changes).length > 0;

  const accountName = (id: string) => accounts?.find((a) => a._id === id)?.name ?? "Account";
  const preview = useMemo(() => {
    if (!validAmount) return [];
    const oldEffect = effect(transaction.type, transaction.amount);
    const newEffect = effect(form.type, amountMinor);
    if (form.accountId === transaction.accountId) {
      const delta = newEffect - oldEffect;
      return delta === 0 ? [] : [{ account: transaction.accountId, delta }];
    }
    return [
      { account: transaction.accountId, delta: -oldEffect },
      { account: form.accountId, delta: newEffect },
    ];
  }, [validAmount, transaction, form.type, form.accountId, amountMinor]);

  const save = () =>
    correct.mutate(
      { id: transaction.id, changes, reason, note: note.trim() || undefined },
      { onSuccess: () => onOpenChange(false) }
    );

  const remove = async (kind: "duplicate" | "not_a_transaction") => {
    const ok = await confirm({
      title: kind === "duplicate" ? "Remove as a duplicate?" : "Not a real transaction?",
      description: `This removes ${formatCurrency(transaction.amount)} from your history and reverses it from ${accountName(transaction.accountId)}. The original stays on record in correction history.`,
      confirmLabel: kind === "duplicate" ? "Remove duplicate" : "Remove it",
      destructive: true,
    });
    if (ok) correct.mutate({ id: transaction.id, changes: {}, reason: kind }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto flex flex-col gap-4 p-5">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>Fix this transaction</SheetTitle>
          <SheetDescription>Your changes are saved alongside the original values, so nothing is lost.</SheetDescription>
        </SheetHeader>

        {sourceInfo && <SourceBanner info={sourceInfo} />}
        {rawText && (
          <blockquote
            className="rounded-(--r-sm) px-3 py-2 text-xs leading-relaxed"
            style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
          >
            {rawText}
          </blockquote>
        )}

        <div className="flex flex-col gap-1.5">
          {fieldLabel("What's wrong?")}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
            {CORRECTION_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={reason === r.value}
                onClick={() => setReason(r.value)}
                className="px-3 py-1.5 rounded-full text-xs font-bold border min-h-8"
                style={{
                  borderColor: reason === r.value ? "var(--violet)" : "var(--line)",
                  background: reason === r.value ? "color-mix(in srgb, var(--violet) 12%, transparent)" : "transparent",
                  color: reason === r.value ? "var(--violet)" : "var(--ink-2)",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            {fieldLabel("Amount (₹)")}
            <Input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))}
              aria-invalid={!validAmount}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            {fieldLabel("Type")}
            <Select value={form.type} onValueChange={(type) => setForm((f) => ({ ...f, type }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Debit (money out)</SelectItem>
                <SelectItem value="income">Credit (money in)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          {fieldLabel("Account")}
          <Select value={form.accountId} onValueChange={(accountId) => setForm((f) => ({ ...f, accountId }))}>
            <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
            <SelectContent>
              {(accounts ?? []).filter((a) => !a.isArchived).map((a) => (
                <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            {fieldLabel("Category")}
            <Select value={form.category} onValueChange={(category) => setForm((f) => ({ ...f, category }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.filter((c) => c.value !== "transfer").map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            {fieldLabel("Date")}
            <DatePickerField value={form.date} onChange={(d) => d && setForm((f) => ({ ...f, date: d }))} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          {fieldLabel("Merchant / description")}
          <Input value={form.description} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>

        <div className="flex flex-col gap-1.5">
          {fieldLabel("Note (optional)")}
          <Textarea value={note} maxLength={500} rows={2} className="resize-none" onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="rounded-(--r-md) px-3.5 py-3 text-sm" style={{ background: "var(--card-2)" }} aria-live="polite">
          {preview.length === 0 ? (
            <span style={{ color: "var(--ink-3)" }}>No balance change.</span>
          ) : (
            preview.map((p) => (
              <div key={p.account} className="flex justify-between gap-3">
                <span style={{ color: "var(--ink-2)" }}>{accountName(p.account)} balance</span>
                <span className="font-bold tnum" style={{ color: p.delta > 0 ? "var(--green)" : "var(--red)" }}>
                  {p.delta > 0 ? "+" : "−"}{formatCurrency(Math.abs(p.delta))}
                </span>
              </div>
            ))
          )}
        </div>

        <Button
          type="button"
          onClick={save}
          disabled={!hasChanges || !reason || !validAmount || correct.isPending}
          className="h-auto py-3 rounded-(--r-sm) font-bold"
        >
          <Save size={16} />
          {correct.isPending ? "Saving..." : "Save correction"}
        </Button>
        {!reason && hasChanges && (
          <p className="text-xs -mt-2" style={{ color: "var(--ink-3)" }}>Pick what&apos;s wrong to save.</p>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t" style={{ borderColor: "var(--line)" }}>
          <Button type="button" variant="secondary" onClick={() => void remove("duplicate")} className="h-auto px-3 py-2 rounded-(--r-sm) font-bold text-sm" style={{ color: "var(--red)" }}>
            <Copy size={14} />
            It&apos;s a duplicate
          </Button>
          <Button type="button" variant="secondary" onClick={() => void remove("not_a_transaction")} className="h-auto px-3 py-2 rounded-(--r-sm) font-bold text-sm" style={{ color: "var(--red)" }}>
            <Ban size={14} />
            Not a transaction
          </Button>
        </div>
        {dialog}
      </SheetContent>
    </Sheet>
  );
}
