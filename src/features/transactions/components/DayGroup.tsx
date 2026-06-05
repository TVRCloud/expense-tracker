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
    return sum + (t.type === "income" ? t.amount : -t.amount);
  }, 0);
  const isPositive = dayTotal >= 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Day label row */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[13px] font-bold" style={{ color: "var(--ink-2)" }}>
          {formatDayLabel(date)}
        </span>
        <span
          className="text-[13px] font-bold tnum"
          style={{ color: isPositive ? "var(--green)" : "var(--red)" }}
        >
          {isPositive ? "+" : ""}
          {formatCurrency(Math.abs(dayTotal))}
        </span>
      </div>

      {/* Transaction rows */}
      <div className="flex flex-col gap-2">
        {transactions.map((t) => (
          <TransactionRow key={String(t._id)} transaction={t} />
        ))}
      </div>
    </div>
  );
}
