"use client";

import { computeUtilization, utilizationColor } from "@/lib/credit-card";
import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/_ui/Progress";

interface CreditUtilizationBarProps {
  balance: number;
  creditLimit: number;
  className?: string;
  compact?: boolean;
}

export function CreditUtilizationBar({ balance, creditLimit, className, compact }: CreditUtilizationBarProps) {
  const { formatCurrency } = useCurrency();
  const pct = computeUtilization(balance, creditLimit);
  const color = utilizationColor(pct);
  const available = Math.max(0, creditLimit - balance);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {!compact && (
        <div className="flex items-center justify-between text-[11px] font-semibold">
          <span style={{ color: "var(--ink-3)" }}>
            {formatCurrency(balance)} used · {formatCurrency(available)} available
          </span>
          <span style={{ color }}>{pct.toFixed(0)}% used</span>
        </div>
      )}
      <Progress
        value={pct}
        color={color}
        trackColor="var(--line-2)"
        height={8}
        aria-label={compact ? `${pct.toFixed(0)}% of credit limit used` : undefined}
      />
      {!compact && (
        <div className="text-[10px] font-medium" style={{ color: "var(--ink-3)" }}>
          Limit {formatCurrency(creditLimit)}
        </div>
      )}
    </div>
  );
}
