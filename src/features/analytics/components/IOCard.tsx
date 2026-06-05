"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  type: "income" | "expense";
  amount: number;
  label?: string;
}

export function IOCard({ type, amount, label }: Props) {
  const { formatCurrency } = useCurrency();
  const isIncome = type === "income";

  const bg = isIncome
    ? "color-mix(in srgb, var(--violet) 11%, var(--card))"
    : "color-mix(in srgb, var(--red) 11%, var(--card))";
  const iconBg = isIncome ? "var(--violet)" : "var(--red)";
  const amountColor = isIncome ? "var(--violet)" : "var(--red)";
  const Icon = isIncome ? ArrowDownLeft : ArrowUpRight;

  return (
    <div
      className="rounded-(--r-md) p-5"
      style={{ background: bg, boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="w-10 h-10 rounded-full grid place-items-center mb-4"
        style={{ background: iconBg }}
      >
        <Icon size={18} color="white" />
      </div>
      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
        style={{ color: "var(--ink-3)" }}
      >
        {label ?? (isIncome ? "Income" : "Expenses")}
      </div>
      <div
        className="text-[22px] font-extrabold tnum leading-none"
        style={{ color: amountColor }}
      >
        {formatCurrency(amount)}
      </div>
    </div>
  );
}
