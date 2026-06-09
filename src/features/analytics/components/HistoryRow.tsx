"use client";

import { format } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { type MonthHistory } from "../hooks/useAnalytics";

interface Props {
  history: MonthHistory;
  onClick?: () => void;
  isActive?: boolean;
}

export function HistoryRow({ history, onClick, isActive }: Props) {
  const { formatCurrency } = useCurrency();
  const monthDate = new Date(history.year, history.month - 1, 1);
  const net = history.stats.income - history.stats.expense;
  const isPositive = net >= 0;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 w-full text-left rounded-[var(--r-md)] px-4 py-3.5 transition-all hover:opacity-90"
      style={
        isActive
          ? { background: "var(--violet)", boxShadow: "0 4px 14px rgba(0,0,0,.25)" }
          : { background: "var(--card)", boxShadow: "var(--shadow-sm)" }
      }
    >
      {/* Month */}
      <div className="w-12 text-center flex-none">
        <div
          className="text-[11px] font-extrabold uppercase tracking-wider"
          style={{ color: isActive ? "rgba(255,255,255,.7)" : "var(--ink-3)" }}
        >
          {format(monthDate, "MMM")}
        </div>
        <div
          className="text-lg font-extrabold tnum"
          style={{ color: isActive ? "#fff" : "var(--ink)" }}
        >
          {format(monthDate, "yy")}
        </div>
      </div>

      {/* Divider */}
      <div className="h-9 w-px flex-none" style={{ background: isActive ? "rgba(255,255,255,.25)" : "var(--line)" }} />

      {/* Income */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: isActive ? "rgba(255,255,255,.7)" : "var(--ink-3)" }}
        >
          Income
        </div>
        <div
          className="text-sm font-bold tnum"
          style={{ color: isActive ? "#fff" : "var(--green)" }}
        >
          +{formatCurrency(history.stats.income)}
        </div>
      </div>

      {/* Expense */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: isActive ? "rgba(255,255,255,.7)" : "var(--ink-3)" }}
        >
          Expense
        </div>
        <div
          className="text-sm font-bold tnum"
          style={{ color: isActive ? "#fff" : "var(--red)" }}
        >
          -{formatCurrency(history.stats.expense)}
        </div>
      </div>

      {/* Net */}
      <div className="text-right flex-none">
        <div
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: isActive ? "rgba(255,255,255,.7)" : "var(--ink-3)" }}
        >
          Net
        </div>
        <div
          className="text-sm font-extrabold tnum"
          style={{ color: isActive ? "#fff" : (isPositive ? "var(--green)" : "var(--red)") }}
        >
          {isPositive ? "+" : ""}{formatCurrency(Math.abs(net))}
        </div>
      </div>
    </button>
  );
}
