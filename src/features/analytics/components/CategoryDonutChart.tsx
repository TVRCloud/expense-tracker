"use client";

import { Cell, Pie, PieChart } from "recharts";
import { useCurrency } from "@/hooks/useCurrency";
import { getCategoryColor } from "@/lib/category-colors";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface Props {
  byCategory: { category: string; total: number }[];
  total: number;
}

export function CategoryDonutChart({ byCategory, total }: Props) {
  const { formatCurrency } = useCurrency();

  const chartData = byCategory.map((c) => ({
    category: c.category,
    total: c.total,
    fill: getCategoryColor(c.category),
  }));

  const chartConfig = byCategory.reduce<ChartConfig>((config, c) => {
    config[c.category] = { label: c.category };
    return config;
  }, {});

  return (
    <div className="flex items-center gap-6">
      <ChartContainer config={chartConfig} className="h-40 w-40 flex-none">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(value) => formatCurrency(Number(value))} />} />
          <Pie
            data={chartData}
            dataKey="total"
            nameKey="category"
            innerRadius={45}
            outerRadius={70}
            strokeWidth={2}
            stroke="var(--card)"
            isAnimationActive
            animationDuration={700}
            animationEasing="ease-out"
          >
            {chartData.map((entry) => (
              <Cell key={entry.category} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {byCategory.slice(0, 6).map(({ category, total: catTotal }) => (
          <div key={category} className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: getCategoryColor(category) }} />
            <span className="text-sm font-semibold capitalize truncate flex-1" style={{ color: "var(--ink)" }}>
              {category}
            </span>
            <span className="text-xs font-bold tnum flex-none" style={{ color: "var(--ink-3)" }}>
              {total > 0 ? Math.round((catTotal / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
