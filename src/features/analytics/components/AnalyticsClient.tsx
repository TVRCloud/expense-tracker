"use client";

import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { format, subMonths, getDaysInMonth } from "date-fns";
import { AnalyticsBarChart } from "./AnalyticsBarChart";
import { CategoryDonutChart } from "./CategoryDonutChart";
import { NetWorthTrendChart } from "./NetWorthTrendChart";
import { IOCard } from "./IOCard";
import { HistoryRow } from "./HistoryRow";
import { useMultiMonthStats } from "../hooks/useAnalytics";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { getCategoryColor } from "@/lib/category-colors";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Progress } from "@/components/_ui/Progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrency } from "@/hooks/useCurrency";

function getLast6Months(): { month: number; year: number }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(now, 5 - i);
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  });
}

type Tab = "income" | "expense";

export function AnalyticsClient() {
  const months = useMemo(getLast6Months, []);
  const [activeIdx, setActiveIdx] = useState(5);
  const [tab, setTab] = useState<Tab>("expense");

  const { data, isLoading } = useMultiMonthStats(months);
  const { data: accounts } = useAccounts();
  const { formatCurrency } = useCurrency();
  const currentTotalBalance = (accounts ?? []).reduce((sum, a) => sum + a.balance, 0);

  // When data first loads, if the current month is empty auto-jump to the most recent month that has data
  useEffect(() => {
    if (!data) return;
    const s = data[activeIdx]?.stats;
    if (s && (s.income > 0 || s.expense > 0)) return;
    for (let i = data.length - 1; i >= 0; i--) {
      const stat = data[i]?.stats;
      if (stat && (stat.income > 0 || stat.expense > 0)) {
        setActiveIdx(i);
        break;
      }
    }
  }, [data]); // intentionally omit activeIdx — only auto-navigate on fresh data load, not on user navigation

  const activeMonth = data?.[activeIdx];
  const activeStats = activeMonth?.stats;

  // Projected month-end spend — only meaningful while viewing the real
  // current calendar month (a "projection" for a past month makes no sense).
  const now = new Date();
  const isViewingCurrentMonth = activeMonth?.month === now.getMonth() + 1 && activeMonth?.year === now.getFullYear();
  const projectedSpend = isViewingCurrentMonth && activeStats
    ? (activeStats.expense / now.getDate()) * getDaysInMonth(now)
    : null;

  // Next-month estimate — trailing average of up to the last 3 months' expense.
  const recentExpenses = (data ?? []).slice(-3).map((h) => h.stats?.expense ?? 0);
  const nextMonthEstimate = recentExpenses.length > 0
    ? recentExpenses.reduce((sum, v) => sum + v, 0) / recentExpenses.length
    : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Chart card */}
      <Card radius="lg" className="p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
              6-Month Overview
            </div>
            <div className="text-lg font-extrabold mt-0.5" style={{ color: "var(--ink)" }}>
              Income vs Expenses
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "var(--violet)" }} />
              <span className="text-xs font-semibold" style={{ color: "var(--ink-2)" }}>Income</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "var(--green)" }} />
              <span className="text-xs font-semibold" style={{ color: "var(--ink-2)" }}>Expense</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-55 w-full rounded-(--r-md)" />
        ) : (
          <AnalyticsBarChart data={data ?? []} />
        )}
      </Card>

      {/* Net worth trend */}
      <Card radius="lg" className="p-5">
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
            Net Worth
          </div>
          <div className="text-lg font-extrabold mt-0.5 tnum" style={{ color: "var(--ink)" }}>
            {formatCurrency(currentTotalBalance)}
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-48 w-full rounded-(--r-md)" />
        ) : (
          <NetWorthTrendChart data={data ?? []} currentTotalBalance={currentTotalBalance} />
        )}
      </Card>

      {/* Month navigator */}
      <div className="flex items-center justify-between px-1">
        <Button type="button" variant="ghost" size="icon" aria-label="Previous month" onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}>
          <ChevronLeft size={20} style={{ color: "var(--ink-3)" }} />
        </Button>
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          {activeMonth
            ? format(new Date(activeMonth.year, activeMonth.month - 1, 1), "MMMM yyyy")
            : "—"}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label="Next month" onClick={() => setActiveIdx((i) => Math.min(months.length - 1, i + 1))}>
          <ChevronRight size={20} style={{ color: "var(--ink-3)" }} />
        </Button>
      </div>

      {/* IO summary cards */}
      {isLoading || !activeStats ? (
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-28 rounded-(--r-md)" />
          <Skeleton className="h-28 rounded-(--r-md)" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <IOCard type="income" amount={activeStats.income} />
          <IOCard type="expense" amount={activeStats.expense} />
        </div>
      )}

      {projectedSpend !== null && (
        <div className="flex items-center gap-2 px-1 -mt-2">
          <TrendingUp size={14} style={{ color: "var(--amber)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--ink-2)" }}>
            Projected by month end: <span className="tnum font-bold" style={{ color: "var(--ink)" }}>{formatCurrency(projectedSpend)}</span>
          </span>
        </div>
      )}

      {/* Tab toggle + breakdown */}
      <Card radius="lg" className="p-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="w-full grid grid-cols-2 rounded-(--r-sm) p-1 mb-5" style={{ background: "var(--card-2)" }}>
            <TabsTrigger value="income" className="rounded-[calc(var(--r-sm)-4px)] text-[13px] font-bold">Income</TabsTrigger>
            <TabsTrigger value="expense" className="rounded-[calc(var(--r-sm)-4px)] text-[13px] font-bold">Expenses</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Expenses tab — category breakdown */}
        {tab === "expense" && activeStats && activeStats.byCategory.length > 0 && (
          <div className="flex flex-col gap-5">
            <CategoryDonutChart byCategory={activeStats.byCategory} total={activeStats.expense} />
            <div className="flex flex-col gap-3">
              {activeStats.byCategory.map(({ category, total }) => {
                const pct = activeStats.expense > 0 ? (total / activeStats.expense) * 100 : 0;
                return (
                  <div key={category} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold capitalize" style={{ color: "var(--ink)" }}>
                        {category}
                      </span>
                      <span className="text-sm font-bold tnum" style={{ color: "var(--ink-2)" }}>
                        {formatCurrency(total)}
                        <span className="text-[11px] ml-1.5" style={{ color: "var(--ink-3)" }}>
                          {Math.round(pct)}%
                        </span>
                      </span>
                    </div>
                    <Progress value={pct} height={8} trackColor="var(--line)" color={getCategoryColor(category)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "expense" && activeStats && activeStats.byCategory.length === 0 && (
          <div className="text-center py-6 text-sm font-semibold" style={{ color: "var(--ink-3)" }}>
            No expense categories this month.
          </div>
        )}

        {/* Income tab — monthly income progression */}
        {tab === "income" && (
          <div className="flex flex-col gap-3">
            {isLoading
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-(--r-sm)" />)
              : (data ?? []).slice().reverse().map((h) => {
                  const maxIncome = Math.max(...(data ?? []).map((d) => d.stats?.income ?? 0), 1);
                  const pct = ((h.stats?.income ?? 0) / maxIncome) * 100;
                  return (
                    <div key={`${h.year}-${h.month}`} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                          {format(new Date(h.year, h.month - 1, 1), "MMM yyyy")}
                        </span>
                        <span className="text-sm font-bold tnum" style={{ color: "var(--violet)" }}>
                          {h.stats ? formatCurrency(h.stats.income) : "—"}
                        </span>
                      </div>
                      <Progress value={pct} height={8} trackColor="var(--line)" color="var(--violet)" />
                    </div>
                  );
                })}
          </div>
        )}
      </Card>

      {/* Monthly history */}
      <Card radius="lg" className="p-5">
        <div className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: "var(--ink-3)" }}>
          Monthly History
        </div>
        <div className="flex flex-col gap-2">
          {isLoading
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-(--r-md)" />)
            : (data ?? []).slice().reverse().map((h, revIdx) => {
                const idx = (data?.length ?? 0) - 1 - revIdx;
                return (
                  <HistoryRow
                    key={`${h.year}-${h.month}`}
                    history={h}
                    isActive={idx === activeIdx}
                    onClick={() => setActiveIdx(idx)}
                  />
                );
              })}
        </div>
        {!isLoading && nextMonthEstimate !== null && (
          <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
            <TrendingUp size={14} style={{ color: "var(--ink-3)" }} />
            <span className="text-xs font-semibold" style={{ color: "var(--ink-3)" }}>
              Next month, at this pace: <span className="tnum font-bold" style={{ color: "var(--ink-2)" }}>~{formatCurrency(nextMonthEstimate)}</span>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
