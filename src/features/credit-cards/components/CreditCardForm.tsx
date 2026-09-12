"use client";

import { type ICreditMeta, type CardNetwork } from "@/types/models";
import { dollarsToCents } from "@/lib/utils";
import { FieldHint } from "@/components/_ui/FieldHint";
import { Input } from "@/components/_ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NETWORKS: { value: CardNetwork; label: string }[] = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "amex", label: "Amex" },
  { value: "rupay", label: "RuPay" },
  { value: "discover", label: "Discover" },
  { value: "diners", label: "Diners" },
];

const labelStyle = {
  color: "var(--ink-3)",
};

interface CreditCardFormProps {
  value: Partial<ICreditMeta>;
  onChange: (meta: Partial<ICreditMeta>) => void;
}

export function CreditCardForm({ value, onChange }: CreditCardFormProps) {
  function set<K extends keyof ICreditMeta>(key: K, v: ICreditMeta[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="flex flex-col gap-3 mt-1">
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--violet)" }}>
        Credit Card Details
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Credit limit */}
        <label className="flex flex-col gap-1.5 col-span-2">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            Credit Limit
            <FieldHint text="Your card's maximum spending limit as set by the bank." />
          </span>
          <Input
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 5000"
            value={value.creditLimit != null ? value.creditLimit / 100 : ""}
            onChange={e => set("creditLimit", e.target.value ? dollarsToCents(Number(e.target.value)) : undefined as unknown as number)}
          />
        </label>

        {/* Billing cycle day */}
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            Statement Close Day
            <FieldHint text="Day of the month your billing cycle ends and your statement is generated (1–31). Clamped to the last day for short months." />
          </span>
          <Input
            type="number"
            min="1"
            max="31"
            placeholder="e.g. 25"
            value={value.billingCycleDay ?? ""}
            onChange={e => set("billingCycleDay", e.target.value ? Number(e.target.value) : undefined as unknown as number)}
          />
          <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>Day of month your bill closes</span>
        </label>

        {/* Payment due day */}
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            Payment Due Day
            <FieldHint text="Day of the month your payment is due in the month after the statement closes. Example: close Jun 20 and due day 31 means payment due Jul 31." />
          </span>
          <Input
            type="number"
            min="1"
            max="31"
            placeholder="e.g. 10"
            value={value.paymentDueDay ?? ""}
            onChange={e => set("paymentDueDay", e.target.value ? Number(e.target.value) : undefined as unknown as number)}
          />
          <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>Due day in the month after statement close</span>
        </label>

        {/* Card network */}
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            Network
            <FieldHint text="The payment network printed on the card (Visa, Mastercard, etc.)." />
          </span>
          <Select
            value={value.network ?? ""}
            onValueChange={(v) => set("network", (v || undefined) as CardNetwork)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select network" />
            </SelectTrigger>
            <SelectContent>
              {NETWORKS.map(n => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>

        {/* Last four digits */}
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            Last 4 Digits
            <FieldHint text="Last four digits of your card number — used to identify the card in the app." />
          </span>
          <Input
            type="text"
            maxLength={4}
            placeholder="1234"
            value={value.lastFourDigits ?? ""}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 4);
              set("lastFourDigits", v || undefined as unknown as string);
            }}
            className="tracking-widest"
          />
        </label>

        {/* Cardholder name */}
        <label className="flex flex-col gap-1.5 col-span-2">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            Cardholder Name
            <FieldHint text="Name as printed on the front of the card." />
          </span>
          <Input
            type="text"
            maxLength={60}
            placeholder="Name on card"
            value={value.cardholderName ?? ""}
            onChange={e => set("cardholderName", e.target.value || undefined as unknown as string)}
          />
        </label>

        {/* APR */}
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            APR (%)
            <FieldHint text="Annual Percentage Rate — yearly interest your bank charges on any balance you carry past the due date (e.g. 18.99% ≈ 1.58%/month)." />
          </span>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="e.g. 18.99"
            value={value.apr ?? ""}
            onChange={e => set("apr", e.target.value ? Number(e.target.value) : undefined as unknown as number)}
          />
        </label>

        {/* Min payment % */}
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider" style={labelStyle}>
            Min Payment (%)
            <FieldHint text="Minimum % of your outstanding balance the bank requires you to pay each month to avoid a late fee — usually 2–5%." />
          </span>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="e.g. 2.0"
            value={value.minPaymentPct ?? ""}
            onChange={e => set("minPaymentPct", e.target.value ? Number(e.target.value) : undefined as unknown as number)}
          />
        </label>
      </div>
    </div>
  );
}
