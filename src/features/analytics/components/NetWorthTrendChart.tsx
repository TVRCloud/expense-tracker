"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  currentTotalBalance: number;
}

const chartConfig = {
  netWorth: { label: "Net worth", color: "var(--violet)" },
} satisfies ChartConfig;

// Reconstructs a net-worth trend from data the app already fetches — no new
// endpoint. Transfers between a user's own accounts net to zero across the
// total balance, so only income/expense (already summed per month by the
// existing multi-month stats query) affect it: walking backward from the
// current total balance, each earlier month's net worth is this month's
// minus that month's (income - expense).
export function NetWorthTrendChart({ data, currentTotalBalance }: Props) {
  const { formatCurrencyCompact } = useCurrency();

  const points: { label: string; netWorth: number }[] = [];
  let running = currentTotalBalance;
  for (let i = data.length - 1; i >= 0; i--) {
    const month = data[i];
    points.unshift({
      label: format(new Date(month.year, month.month - 1, 1), "MMM"),
      netWorth: running,
    });
    if (month.stats) running -= month.stats.income - month.stats.expense;
  }

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <AreaChart data={points}>
        <defs>
          <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-netWorth)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-netWorth)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
          cursor={{ stroke: "var(--line)" }}
          content={<ChartTooltipContent formatter={(value) => `Net worth: ${formatCurrencyCompact(Number(value))}`} />}
        />
        <Area
          type="monotone"
          dataKey="netWorth"
          stroke="var(--color-netWorth)"
          strokeWidth={2}
          fill="url(#netWorthFill)"
          isAnimationActive
          animationDuration={800}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ChartContainer>
  );
}
