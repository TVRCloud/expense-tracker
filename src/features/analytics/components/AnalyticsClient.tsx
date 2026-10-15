"use client";

import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { format, subMonths, getDaysInMonth } from "date-fns";
import { AnalyticsBarChart } from "./AnalyticsBarChart";
import { CategoryRingGrid } from "./CategoryRingGrid";
import { NetWorthTrendChart } from "./NetWorthTrendChart";
import { IOCard } from "./IOCard";
import { HistoryRow } from "./HistoryRow";
import { useMultiMonthStats } from "../hooks/useAnalytics";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { getCategoryColor } from "@/lib/category-colors";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { PageHeader } from "@/components/shared/PageHeader";
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

  const monthLabel = activeMonth ? format(new Date(activeMonth.year, activeMonth.month - 1, 1), "MMMM yyyy") : "—";
  const net = activeStats ? activeStats.income - activeStats.expense : 0;
  const savingsRate = activeStats && activeStats.income > 0 ? Math.round((net / activeStats.income) * 100) : null;
  const sectionLabel = { font: "var(--text-label)", color: "var(--ink-3)" } as const;

  const monthStepper = (
    <div className="flex items-center rounded-full p-0.5" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
      <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="Previous month" disabled={activeIdx === 0} onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}>
        <ChevronLeft size={18} style={{ color: "var(--ink-2)" }} />
      </Button>
      <span className="px-2 min-w-32 text-center tnum" aria-live="polite" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>
        {monthLabel}
      </span>
      <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="Next month" disabled={activeIdx === months.length - 1} onClick={() => setActiveIdx((i) => Math.min(months.length - 1, i + 1))}>
        <ChevronRight size={18} style={{ color: "var(--ink-2)" }} />
      </Button>
    </div>
  );

  const legend = (color: string, text: string) => (
    <span className="flex items-center gap-1.5" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
      {text}
    </span>
  );

  return (
    <div className="page-stack">
      <PageHeader title="Analytics" subtitle="Last six months of income, spending and net worth" actions={monthStepper} />

      {/* KPI strip */}
      <div className="grid-cards" style={{ "--card-min": "200px" } as React.CSSProperties}>
        {isLoading || !activeStats ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-(--r-lg)" />)
        ) : (
          <>
            <IOCard type="income" amount={activeStats.income} />
            <IOCard type="expense" amount={activeStats.expense} hint={projectedSpend !== null ? `Projected ${formatCurrency(projectedSpend)} by month end` : undefined} />
            <IOCard type="net" amount={net} label="Net" hint={savingsRate !== null ? `${savingsRate}% of income ${net >= 0 ? "saved" : "overspent"}` : undefined} />
            <Card radius="lg" className="p-5 flex flex-col gap-3 min-w-0">
              <span style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>Net worth</span>
              <div className="tnum truncate" style={{ font: "var(--text-stat)", color: "var(--ink)" }}>{formatCurrency(currentTotalBalance)}</div>
              <div style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>Across all accounts</div>
            </Card>
          </>
        )}
      </div>

      <div className="grid-split">
        <div className="page-stack">
          {/* Trend */}
          <Card radius="lg" className="p-5 sm:p-6">
            <div className="section-head">
              <h2>Income vs expenses</h2>
              <div className="flex items-center gap-4">
                {legend("var(--green)", "Income")}
                {legend("var(--violet)", "Expense")}
              </div>
            </div>
            {isLoading ? <Skeleton className="h-64 lg:h-80 w-full rounded-(--r-md)" /> : <AnalyticsBarChart data={data ?? []} />}
          </Card>

          {/* Breakdown */}
          <Card radius="lg" className="p-5 sm:p-6">
            <div className="section-head">
              <h2>{tab === "expense" ? "Where it went" : "Income by month"}</h2>
              <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
                <TabsList className="rounded-full p-0.5" style={{ background: "var(--card-2)" }}>
                  <TabsTrigger value="expense" className="rounded-full px-3.5 text-[13px] font-semibold">Expenses</TabsTrigger>
                  <TabsTrigger value="income" className="rounded-full px-3.5 text-[13px] font-semibold">Income</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {tab === "expense" && activeStats && activeStats.byCategory.length > 0 && (
              <div className="flex flex-col gap-6">
                <CategoryRingGrid byCategory={activeStats.byCategory} total={activeStats.expense} />
                <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
                  {activeStats.byCategory.map(({ category, total }) => {
                    const pct = activeStats.expense > 0 ? (total / activeStats.expense) * 100 : 0;
                    return (
                      <div key={category} className="flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="capitalize truncate" style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{category}</span>
                          <span className="tnum flex-none" style={{ font: "var(--text-figure-sm)", color: "var(--ink-2)" }}>
                            {formatCurrency(total)}
                            <span className="ml-1.5" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>{Math.round(pct)}%</span>
                          </span>
                        </div>
                        <Progress value={pct} height={6} trackColor="var(--line)" color={getCategoryColor(category)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "expense" && activeStats && activeStats.byCategory.length === 0 && (
              <div className="text-center py-8" style={{ font: "var(--text-body)", color: "var(--ink-3)" }}>
                No expense categories this month.
              </div>
            )}

            {tab === "income" && (
              <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
                {isLoading
                  ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-(--r-sm)" />)
                  : (data ?? []).slice().reverse().map((h) => {
                      const maxIncome = Math.max(...(data ?? []).map((d) => d.stats?.income ?? 0), 1);
                      const pct = ((h.stats?.income ?? 0) / maxIncome) * 100;
                      return (
                        <div key={`${h.year}-${h.month}`} className="flex flex-col gap-1.5">
                          <div className="flex items-baseline justify-between">
                            <span style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>{format(new Date(h.year, h.month - 1, 1), "MMM yyyy")}</span>
                            <span className="tnum" style={{ font: "var(--text-figure-sm)", color: "var(--green)" }}>{h.stats ? formatCurrency(h.stats.income) : "—"}</span>
                          </div>
                          <Progress value={pct} height={6} trackColor="var(--line)" color="var(--green)" />
                        </div>
                      );
                    })}
              </div>
            )}
          </Card>
        </div>

        <div className="rail page-stack">
          {/* Net worth */}
          <Card radius="lg" className="p-5">
            <div className="mb-3">
              <div style={sectionLabel}>Net worth trend</div>
              <div className="tnum mt-1" style={{ font: "var(--text-stat)", color: "var(--ink)" }}>{formatCurrency(currentTotalBalance)}</div>
            </div>
            {isLoading ? <Skeleton className="h-48 w-full rounded-(--r-md)" /> : <NetWorthTrendChart data={data ?? []} currentTotalBalance={currentTotalBalance} />}
          </Card>

          {/* Monthly history */}
          <div>
            <div className="section-head"><h2>Monthly history</h2></div>
            {isLoading ? (
              <Skeleton className="h-40 rounded-(--r-md)" />
            ) : (
              <div className="inset-group" style={{ "--inset": "28px" } as React.CSSProperties}>
                {(data ?? []).slice().reverse().map((h, revIdx) => {
                  const idx = (data?.length ?? 0) - 1 - revIdx;
                  // Skip months with no activity, but always keep the current month so the list is never empty.
                  const hasActivity = (h.stats?.income ?? 0) > 0 || (h.stats?.expense ?? 0) > 0;
                  const isCurrentMonth = idx === (data?.length ?? 0) - 1;
                  if (!hasActivity && !isCurrentMonth) return null;
                  return <HistoryRow key={`${h.year}-${h.month}`} history={h} isActive={idx === activeIdx} onClick={() => setActiveIdx(idx)} />;
                })}
              </div>
            )}
            {!isLoading && nextMonthEstimate !== null && (
              <div className="flex items-center gap-2 mt-3 px-1" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
                <TrendingUp size={14} aria-hidden />
                <span>Next month, at this pace: <span className="tnum" style={{ color: "var(--ink-2)", fontWeight: 600 }}>~{formatCurrency(nextMonthEstimate)}</span></span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
