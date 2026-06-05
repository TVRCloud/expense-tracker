"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, subMonths } from "date-fns";
import { AnalyticsBarChart } from "./AnalyticsBarChart";
import { IOCard } from "./IOCard";
import { HistoryRow } from "./HistoryRow";
import { useMultiMonthStats } from "../hooks/useAnalytics";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { formatCurrency } = useCurrency();

  const activeMonth = data?.[activeIdx];
  const activeStats = activeMonth?.stats;

  return (
    <div className="flex flex-col gap-5">
      {/* Chart card */}
      <div
        className="rounded-(--r-lg) p-5"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
      >
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
          <Skeleton className="h-[220px] w-full rounded-(--r-md)" />
        ) : (
          <AnalyticsBarChart data={data ?? []} />
        )}
      </div>

      {/* Month navigator */}
      <div className="flex items-center justify-between px-1">
        <button onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}>
          <ChevronLeft size={20} style={{ color: "var(--ink-3)" }} />
        </button>
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>
          {activeMonth
            ? format(new Date(activeMonth.year, activeMonth.month - 1, 1), "MMMM yyyy")
            : "—"}
        </span>
        <button onClick={() => setActiveIdx((i) => Math.min(months.length - 1, i + 1))}>
          <ChevronRight size={20} style={{ color: "var(--ink-3)" }} />
        </button>
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

      {/* Tab toggle + breakdown */}
      <div
        className="rounded-(--r-lg) p-5"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
      >
        {/* Tabs */}
        <div
          className="flex rounded-(--r-sm) p-1 mb-5"
          style={{ background: "var(--card-2)" }}
        >
          {(["income", "expense"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2 text-[13px] font-bold rounded-[calc(var(--r-sm)-4px)] transition-all"
              style={{
                background: tab === t ? "var(--card)" : "transparent",
                color: tab === t ? "var(--ink)" : "var(--ink-3)",
                boxShadow: tab === t ? "var(--shadow-sm)" : "none",
              }}
            >
              {t === "income" ? "Income" : "Expenses"}
            </button>
          ))}
        </div>

        {/* Expenses tab — category breakdown */}
        {tab === "expense" && activeStats && activeStats.byCategory.length > 0 && (
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
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: "var(--violet)" }}
                    />
                  </div>
                </div>
              );
            })}
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
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: "var(--violet)" }}
                        />
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
      </div>

      {/* Monthly history */}
      <div
        className="rounded-(--r-lg) p-5"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
      >
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
      </div>
    </div>
  );
}
