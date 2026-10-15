"use client";

import { format } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { type MonthHistory } from "../hooks/useAnalytics";

interface Props {
  history: MonthHistory;
  onClick?: () => void;
  isActive?: boolean;
}

/** Row inside an .inset-group; active month gets a quiet tint and an ink marker. */
export function HistoryRow({ history, onClick, isActive }: Props) {
  const { formatCurrency } = useCurrency();
  const monthDate = new Date(history.year, history.month - 1, 1);
  const net = history.stats.income - history.stats.expense;
  const isPositive = net >= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      className="flex items-center gap-3 w-full text-left px-4 py-3 min-h-14 transition-colors active:scale-[0.99] hover:bg-(--card-2) focus-visible:outline-none focus-visible:bg-(--card-2)"
      style={isActive ? { background: "var(--card-2)" } : undefined}
    >
      <span
        className="w-1 h-8 rounded-full flex-none"
        style={{ background: isActive ? "var(--ink)" : "transparent" }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div style={{ font: "var(--text-body)", color: "var(--ink)", fontWeight: 600 }}>{format(monthDate, "MMMM yyyy")}</div>
        <div className="tnum truncate" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
          <span style={{ color: "var(--green)" }}>+{formatCurrency(history.stats.income)}</span>
          {"  "}
          <span style={{ color: "var(--red)" }}>−{formatCurrency(history.stats.expense)}</span>
        </div>
      </div>
      <div className="text-right flex-none tnum" style={{ font: "var(--text-figure-sm)", color: isPositive ? "var(--green)" : "var(--red)" }}>
        {isPositive ? "+" : "−"}{formatCurrency(Math.abs(net))}
      </div>
    </button>
  );
}
