"use client";

import { format } from "date-fns";
import { CheckCircle, AlertCircle, Clock } from "lucide-react";
import { type ICreditStatement } from "@/types/models";
import { useCurrency } from "@/hooks/useCurrency";

interface StatementRowProps {
  statement: ICreditStatement;
  onPayNow: (statement: ICreditStatement) => void;
}

const STATUS_CONFIG = {
  paid: { icon: CheckCircle, color: "var(--green)", label: "Paid", bg: "rgba(79,192,126,.1)" },
  overdue: { icon: AlertCircle, color: "var(--red)", label: "Overdue", bg: "rgba(235,87,87,.1)" },
  closed: { icon: Clock, color: "#f59e0b", label: "Unpaid", bg: "rgba(245,158,11,.1)" },
  open: { icon: Clock, color: "var(--ink-3)", label: "Open", bg: "var(--card-2)" },
};

export function StatementRow({ statement, onPayNow }: StatementRowProps) {
  const { formatCurrency } = useCurrency();
  const status = statement.status as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;
  const Icon = cfg.icon;
  const statementBalance = statement.statementBalance ?? statement.balance ?? 0;
  const remainingDue = statement.remainingDue ?? Math.max(0, statementBalance - (statement.paidAmount ?? 0));

  const periodLabel = `${format(new Date(statement.periodStart), "MMM d")} – ${format(new Date(statement.periodEnd), "MMM d, yyyy")}`;
  const dueLabel = format(new Date(statement.dueDate), "MMM d, yyyy");

  return (
    <div
      className="flex items-center gap-4 rounded-[var(--r-md)] px-4 py-3.5"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="w-9 h-9 rounded-[10px] grid place-items-center flex-none"
        style={{ background: cfg.bg }}
      >
        <Icon size={17} style={{ color: cfg.color }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>
          {format(new Date(statement.periodEnd), "MMMM yyyy")}
        </div>
        <div className="text-[11px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
          {periodLabel} · Due {dueLabel}
        </div>
        {statement.paidAmount > 0 && (
          <div className="text-[11px] font-medium mt-0.5" style={{ color: statement.isPaid ? "var(--green)" : "#f59e0b" }}>
            {statement.isPaid ? "Paid" : "Part paid"} {formatCurrency(statement.paidAmount)}
            {statement.paidAt ? ` on ${format(new Date(statement.paidAt), "MMM d")}` : ""}
          </div>
        )}
      </div>

      <div className="text-right flex-none">
        <div className="text-[15px] font-extrabold tnum" style={{ color: remainingDue > 0 ? "var(--red)" : "var(--ink)" }}>
          {formatCurrency(remainingDue)}
        </div>
        <div className="text-[10px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
          of {formatCurrency(statementBalance)}
        </div>
        <div
          className="inline-flex items-center gap-1 text-[10px] font-bold mt-0.5 px-1.5 py-0.5 rounded"
          style={{ background: cfg.bg, color: cfg.color }}
        >
          {cfg.label}
        </div>
      </div>

      {remainingDue > 0 && status !== "open" && (
        <button
          type="button"
          onClick={() => onPayNow(statement)}
          className="flex-none px-3 py-1.5 rounded-[var(--r-sm)] text-[12px] font-bold"
          style={{ background: "var(--violet)", color: "#fff" }}
        >
          Pay
        </button>
      )}
    </div>
  );
}
