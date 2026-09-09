"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { type MonthHistory } from "../hooks/useAnalytics";
import { useCurrency } from "@/hooks/useCurrency";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface Props {
  data: MonthHistory[];
}

const chartConfig = {
  income: { label: "Income", color: "var(--violet)" },
  expense: { label: "Expense", color: "var(--green)" },
} satisfies ChartConfig;

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
    <ChartContainer config={chartConfig} className="h-55 w-full">
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
        <ChartTooltip
          cursor={{ fill: "var(--line)", radius: 6 }}
          content={<ChartTooltipContent formatter={(value, name) => `${chartConfig[name as keyof typeof chartConfig]?.label ?? name}: ${formatCurrencyCompact(Number(value))}`} />}
        />
        <Bar dataKey="income" fill="var(--color-income)" radius={[6, 6, 0, 0]} maxBarSize={32} />
        <Bar dataKey="expense" fill="var(--color-expense)" radius={[6, 6, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ChartContainer>
  );
}
