"use client";

import { format } from "date-fns";
import { type ICreditStatement } from "@/types/models";
import { useCurrency } from "@/hooks/useCurrency";
import { STATEMENT_STATUS_ICONS } from "@/lib/icons";
import { Button } from "@/components/_ui/Button";

interface StatementRowProps {
  statement: ICreditStatement;
  onPayNow: (statement: ICreditStatement) => void;
}

const STATUS_CONFIG = {
  paid: { icon: STATEMENT_STATUS_ICONS.paid, color: "var(--green)", label: "Paid", bg: "color-mix(in srgb, var(--green) 12%, transparent)" },
  overdue: { icon: STATEMENT_STATUS_ICONS.overdue, color: "var(--red)", label: "Overdue", bg: "color-mix(in srgb, var(--red) 12%, transparent)" },
  closed: { icon: STATEMENT_STATUS_ICONS.closed, color: "var(--amber)", label: "Unpaid", bg: "color-mix(in srgb, var(--amber) 12%, transparent)" },
  open: { icon: STATEMENT_STATUS_ICONS.open, color: "var(--ink-3)", label: "Open", bg: "var(--card-2)" },
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
    <div className="flex items-center gap-3 sm:gap-4 px-4 py-3 min-h-[64px]">
      <div
        className="w-10 h-10 rounded-full grid place-items-center flex-none"
        style={{ background: cfg.bg }}
      >
        <Icon size={17} style={{ color: cfg.color }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium" style={{ color: "var(--ink)" }}>
          {format(new Date(statement.periodEnd), "MMMM yyyy")}
        </div>
        <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>
          {periodLabel} · Due {dueLabel}
        </div>
        {statement.paidAmount > 0 && (
          <div className="text-[11px] font-medium mt-0.5" style={{ color: statement.isPaid ? "var(--green)" : "var(--amber)" }}>
            {statement.isPaid ? "Paid" : "Part paid"} {formatCurrency(statement.paidAmount)}
            {statement.paidAt ? ` on ${format(new Date(statement.paidAt), "MMM d")}` : ""}
          </div>
        )}
      </div>

      <div className="text-right flex-none">
        <div className="tnum" style={{ font: "var(--text-figure-sm)", fontSize: 15, color: remainingDue > 0 ? "var(--red)" : "var(--ink)" }}>
          {formatCurrency(remainingDue)}
        </div>
        <div className="text-[10px] font-medium mt-0.5" style={{ color: "var(--ink-3)" }}>
          of {formatCurrency(statementBalance)}
        </div>
        <div
          className="inline-flex items-center gap-1 text-[10px] font-bold mt-1 px-2 py-0.5 rounded-full"
          style={{ background: cfg.bg, color: cfg.color }}
        >
          {cfg.label}
        </div>
      </div>

      {remainingDue > 0 && status !== "open" && (
        <Button
          type="button"
          onClick={() => onPayNow(statement)}
          className="flex-none h-9 px-4 rounded-full text-[13px] font-semibold"
        >
          Pay
        </Button>
      )}
    </div>
  );
}
