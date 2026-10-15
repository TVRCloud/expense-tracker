import type React from "react";
import { format, isToday, isYesterday } from "date-fns";
import { TransactionRow } from "./TransactionRow";
import { type ITransaction } from "@/types/models";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  date: Date;
  transactions: ITransaction[];
}

function formatDayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, d MMM");
}

export function DayGroup({ date, transactions }: Props) {
  const { formatCurrency } = useCurrency();
  const dayTotal = transactions.reduce((sum, t) => {
    if (t.type === "transfer") return sum;
    return sum + (t.type === "income" ? t.amount : -t.amount);
  }, 0);
  const isPositive = dayTotal >= 0;

  return (
    <section>
      {/* Sticky day header: translucent chrome so rows scroll beneath it */}
      <div
        className="chrome sticky top-0 md:top-(--topbar-h) z-10 flex items-baseline justify-between px-1 py-2 -mx-1"
      >
        <h3 style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>{formatDayLabel(date)}</h3>
        {/* Always signed: colour alone doesn't say "net spent". */}
        <span
          className="tnum"
          style={{ font: "var(--text-label)", fontFamily: "var(--font-mono)", color: isPositive ? "var(--green)" : "var(--red)" }}
          aria-label={`Day total ${isPositive ? "plus" : "minus"} ${formatCurrency(Math.abs(dayTotal))}`}
        >
          {isPositive ? "+" : "−"}
          {formatCurrency(Math.abs(dayTotal))}
        </span>
      </div>

      <div className="inset-group" style={{ "--inset": "72px" } as React.CSSProperties}>
        {transactions.map((t) => (
          <TransactionRow key={String(t._id)} transaction={t} hideDate grouped />
        ))}
      </div>
    </section>
  );
}
