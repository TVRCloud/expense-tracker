"use client";

import { useEffect, useState, useMemo } from "react";
import { startOfDay } from "date-fns";
import { Search, X, Download, Plus, Repeat } from "lucide-react";
import Link from "next/link";
import { FilterChips } from "./FilterChips";
import { DayGroup } from "./DayGroup";
import { useTransactions } from "../hooks/useTransactions";
import { type ITransaction } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { PageHeader } from "@/components/shared/PageHeader";
import { useCurrency } from "@/hooks/useCurrency";
import { canonicalizeCategory } from "@/lib/category-colors";
import { getTransactionActivityDate } from "../utils/activity-date";

const TYPE_CHIPS = [
  { label: "All", value: "" },
  { label: "Expenses", value: "expense" },
  { label: "Income", value: "income" },
  { label: "Transfers", value: "transfer" },
];

const CAT_CHIPS = [
  { label: "Groceries", value: "groceries" },
  { label: "Transport", value: "transport" },
  { label: "Shopping", value: "shopping" },
  { label: "Health", value: "health" },
  { label: "Rent", value: "rent" },
  { label: "Coffee", value: "coffee" },
  { label: "Education", value: "education" },
  { label: "Other", value: "other" },
];

function groupByDay(transactions: ITransaction[]): Map<string, { date: Date; items: ITransaction[] }> {
  const map = new Map<string, { date: Date; items: ITransaction[] }>();
  for (const t of transactions) {
    const day = startOfDay(getTransactionActivityDate(t));
    const key = day.toISOString();
    if (!map.has(key)) map.set(key, { date: day, items: [] });
    map.get(key)!.items.push(t);
  }
  return map;
}

export function TransactionsClient({ accountId }: { accountId?: string }) {
  const [typeFilter, setTypeFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [limit, setLimit] = useState(50);
  const { formatCurrency } = useCurrency();

  // Live search, debounced — no Enter needed.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isFetching } = useTransactions({
    type: typeFilter || undefined,
    category: catFilter || undefined,
    accountId,
    search: search || undefined,
    hideFuture: true,
    limit,
  });

  const groups = useMemo(() => {
    if (!data?.data) return [];
    const grouped = groupByDay(data.data);
    return Array.from(grouped.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [data?.data]);

  // Totals for what is on screen (loaded rows), so the rail answers
  // "what did this filter add up to" without leaving the page.
  const summary = useMemo(() => {
    const rows = data?.data ?? [];
    let income = 0;
    let expense = 0;
    const byCat = new Map<string, number>();
    for (const t of rows) {
      if (t.type === "income") income += t.amount;
      else if (t.type === "expense") {
        expense += t.amount;
        const k = canonicalizeCategory(t.category);
        byCat.set(k, (byCat.get(k) ?? 0) + t.amount);
      }
    }
    const top = Array.from(byCat.entries()).sort((x, y) => y[1] - x[1]).slice(0, 5);
    return { income, expense, net: income - expense, count: rows.length, top };
  }, [data?.data]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ format: "csv" });
    if (typeFilter) params.set("type", typeFilter);
    if (catFilter) params.set("category", catFilter);
    if (accountId) params.set("accountId", accountId);
    if (search) params.set("search", search);
    return `/api/transactions?${params.toString()}`;
  }, [typeFilter, catFilter, accountId, search]);

  const filtered = Boolean(search || typeFilter || catFilter);
  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setTypeFilter("");
    setCatFilter("");
  };
  const loadedCount = data?.data?.length ?? 0;
  const total = data?.total ?? loadedCount;
  const netPositive = summary.net >= 0;

  return (
    <div className="page-stack md:[--filter-h:68px]">
      <PageHeader
        title="Transactions"
        subtitle={data ? `${total} ${total === 1 ? "transaction" : "transactions"}${filtered ? " match" : ""}` : undefined}
        actions={
          <>
            <Button asChild variant="ghost" className="btn-interactive h-10 rounded-full px-3.5 text-[13px] font-semibold" style={{ color: "var(--ink-2)" }}>
              <a href={exportHref}>
                <Download size={15} />
                Export
              </a>
            </Button>
            <Button asChild variant="secondary" className="btn-interactive h-10 rounded-full px-4 text-[13px] font-semibold">
              <Link href="/transactions/recurring">
                <Repeat size={15} />
                Recurring
              </Link>
            </Button>
            <Button asChild className="btn-interactive hidden md:inline-flex h-10 rounded-full px-5 text-[13px] font-semibold">
              <Link href="/transactions/add">
                <Plus size={16} />
                Add transaction
              </Link>
            </Button>
          </>
        }
      />

      {/* Sticky translucent filter bar: search + type segmented control */}
      <div
        className="chrome sticky top-0 md:top-(--topbar-h) z-20 -mx-(--gutter) px-(--gutter) py-2.5 flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <div
          className="flex items-center gap-2.5 h-11 px-3.5 rounded-full md:max-w-md md:flex-1"
          style={{ background: "var(--card-2)" }}
        >
          <Search size={17} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          <Input
            className="flex-1 h-auto border-0 bg-transparent p-0 text-[15px] shadow-none placeholder:text-(--ink-3) text-(--ink) focus-visible:ring-0 focus-visible:ring-offset-0"
            placeholder="Search transactions"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search transactions"
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearch(searchInput.trim());
              if (e.key === "Escape") {
                setSearchInput("");
                setSearch("");
              }
            }}
          />
          {searchInput && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              aria-label="Clear search"
              onClick={() => {
                setSearchInput("");
                setSearch("");
              }}
            >
              <X size={15} style={{ color: "var(--ink-3)" }} />
            </Button>
          )}
        </div>
        <FilterChips variant="segmented" chips={TYPE_CHIPS} active={typeFilter} onChange={setTypeFilter} />
      </div>

      {/* Category chips (only for expense / all) */}
      {typeFilter !== "income" && typeFilter !== "transfer" && (
        <div className="-mx-(--gutter) px-(--gutter) overflow-x-auto scrollbar-none">
          <FilterChips
            chips={[{ label: "All categories", value: "" }, ...CAT_CHIPS]}
            active={catFilter}
            onChange={setCatFilter}
          />
        </div>
      )}

      {/* Compact summary on narrow screens; the rail takes over from lg */}
      {!isLoading && groups.length > 0 && (
        <div className="grid grid-cols-3 gap-2 lg:hidden">
          <MiniStat label="Income" value={formatCurrency(summary.income)} color="var(--green)" />
          <MiniStat label="Spent" value={formatCurrency(summary.expense)} color="var(--red)" />
          <MiniStat label="Net" value={`${netPositive ? "+" : "−"}${formatCurrency(Math.abs(summary.net))}`} color={netPositive ? "var(--green)" : "var(--red)"} />
        </div>
      )}

      <div className="grid-split">
        <div className="min-w-0 flex flex-col gap-5">
          {isLoading ? (
            <div className="flex flex-col gap-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-28 rounded-full" />
                  <Skeleton className="h-40 w-full rounded-(--r-md)" />
                </div>
              ))}
            </div>
          ) : groups.length === 0 ? (
            <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
              <div className="w-14 h-14 rounded-full grid place-items-center" style={{ background: "var(--card-2)" }}>
                <Search size={24} style={{ color: "var(--ink-3)" }} />
              </div>
              <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
                {filtered ? "Nothing matches these filters" : "No transactions yet"}
              </p>
              {filtered ? (
                <Button variant="secondary" className="btn-interactive rounded-full" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild className="btn-interactive rounded-full">
                  <Link href="/transactions/add">Add a transaction</Link>
                </Button>
              )}
            </Card>
          ) : (
            <>
              {groups.map((group) => (
                <DayGroup key={group.date.toISOString()} date={group.date} transactions={group.items} />
              ))}
              {data && data.total > loadedCount && (
                <Button
                  variant="secondary"
                  onClick={() => setLimit((current) => current + 50)}
                  disabled={isFetching}
                  aria-busy={isFetching}
                  className="btn-interactive w-full h-12 rounded-(--r-md) font-semibold"
                >
                  {isFetching ? "Loading…" : `Show more (${data.total - loadedCount} remaining)`}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Side rail: totals for the current filter */}
        <aside className="rail hidden lg:flex flex-col gap-4" aria-label="Summary for current filter">
          <Card radius="lg" className="p-6 flex flex-col gap-5">
            <div className="flex items-baseline justify-between">
              <h2 style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>Summary</h2>
              <span style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
                {filtered ? "Filtered" : "All"} · {summary.count} shown
              </span>
            </div>
            <div>
              <div style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>Net</div>
              <div
                className="tnum mt-1"
                style={{ font: "var(--text-stat)", fontFamily: "var(--font-mono)", color: netPositive ? "var(--green)" : "var(--red)" }}
              >
                {netPositive ? "+" : "−"}
                {formatCurrency(Math.abs(summary.net))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Income" value={formatCurrency(summary.income)} color="var(--green)" />
              <MiniStat label="Spent" value={formatCurrency(summary.expense)} color="var(--red)" />
            </div>
          </Card>

          {summary.top.length > 0 && (
            <Card radius="lg" className="p-6 flex flex-col gap-4">
              <h2 style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>Top categories</h2>
              {summary.top.map(([cat, amt]) => (
                <div key={cat}>
                  <div className="flex justify-between mb-1.5">
                    <span className="capitalize" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>{cat}</span>
                    <span className="tnum" style={{ font: "var(--text-figure-sm)", fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
                      {formatCurrency(amt)}
                    </span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${summary.expense ? (amt / summary.expense) * 100 : 0}%`, background: "var(--ink-2)" }}
                    />
                  </div>
                </div>
              ))}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-(--r-sm) px-3 py-2.5 min-w-0" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>{label}</div>
      <div className="tnum truncate mt-0.5" style={{ font: "var(--text-figure-sm)", fontFamily: "var(--font-mono)", color }}>
        {value}
      </div>
    </div>
  );
}
