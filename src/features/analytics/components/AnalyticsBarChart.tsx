"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { type MonthHistory } from "../hooks/useAnalytics";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  data: MonthHistory[];
}

interface TooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  formatCompact: (v: number) => string;
}

function CustomTooltip({ active, payload, label, formatCompact }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-[var(--r-sm)] px-4 py-3 text-sm"
      style={{ background: "var(--card)", boxShadow: "var(--shadow)", border: "1px solid var(--line)" }}
    >
      <p className="font-bold mb-1.5" style={{ color: "var(--ink)" }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-semibold tnum" style={{ color: p.color }}>
          {p.name}: {formatCompact(p.value)}
        </p>
      ))}
    </div>
  );
}

export function AnalyticsBarChart({ data }: Props) {
  const { formatCurrencyCompact } = useCurrency();
  const chartData = data
    .filter((d) => d.stats != null)
    .map((d) => ({
      label: format(new Date(d.year, d.month - 1, 1), "MMM"),
      income: d.stats.income,
      expense: d.stats.expense,
    }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} barCategoryGap="28%" barGap={4}>
        <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--line)" />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--ink-3)", fontSize: 12, fontWeight: 600 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--ink-3)", fontSize: 11, fontWeight: 600 }}
          tickFormatter={(v: number) => formatCurrencyCompact(v)}
          width={52}
        />
        <Tooltip content={<CustomTooltip formatCompact={formatCurrencyCompact} />} cursor={{ fill: "var(--line)", radius: 6 }} />
        <Bar dataKey="income" name="Income" fill="var(--violet)" radius={[6, 6, 0, 0]} maxBarSize={32} />
        <Bar dataKey="expense" name="Expense" fill="var(--green)" radius={[6, 6, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}
