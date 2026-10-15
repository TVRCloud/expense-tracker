"use client";

import { ArrowDownLeft, ArrowUpRight, Minus, Plus } from "lucide-react";
import { Card } from "@/components/_ui/Card";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  type: "income" | "expense" | "net";
  amount: number;
  label?: string;
  hint?: string;
}

/** KPI tile: small icon chip, quiet label, mono figure. Used in the analytics KPI strip. */
export function IOCard({ type, amount, label, hint }: Props) {
  const { formatCurrency } = useCurrency();
  const color = type === "income" ? "var(--green)" : type === "expense" ? "var(--red)" : amount >= 0 ? "var(--green)" : "var(--red)";
  const Icon = type === "income" ? ArrowDownLeft : type === "expense" ? ArrowUpRight : amount >= 0 ? Plus : Minus;
  const text = label ?? (type === "income" ? "Income" : type === "expense" ? "Expenses" : "Net");

  return (
    <Card radius="lg" className="p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded-full grid place-items-center flex-none"
          style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
        >
          <Icon size={15} aria-hidden />
        </span>
        <span style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>{text}</span>
      </div>
      <div className="tnum truncate" style={{ font: "var(--text-stat)", color: "var(--ink)" }}>
        {formatCurrency(type === "net" ? Math.abs(amount) : amount)}
      </div>
      {hint && <div style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>{hint}</div>}
    </Card>
  );
}
