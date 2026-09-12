"use client";

import { useState, useMemo } from "react";
import { startOfDay } from "date-fns";
import { Search, X, Download } from "lucide-react";
import Link from "next/link";
import { FilterChips } from "./FilterChips";
import { DayGroup } from "./DayGroup";
import { useTransactions } from "../hooks/useTransactions";
import { type ITransaction } from "@/types/models";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
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

  const { data, isLoading } = useTransactions({
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

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ format: "csv" });
    if (typeFilter) params.set("type", typeFilter);
    if (catFilter) params.set("category", catFilter);
    if (accountId) params.set("accountId", accountId);
    if (search) params.set("search", search);
    return `/api/transactions?${params.toString()}`;
  }, [typeFilter, catFilter, accountId, search]);

  return (
    <div className="flex flex-col gap-5">
      {/* Recurring + export */}
      <div className="flex items-center justify-end gap-4">
        <a
          href={exportHref}
          className="inline-flex items-center gap-1.5 text-sm font-bold"
          style={{ color: "var(--ink-2)" }}
        >
          <Download size={14} />
          Export CSV
        </a>
        <Link
          href="/transactions/recurring"
          className="inline-flex items-center gap-1.5 text-sm font-bold"
          style={{ color: "var(--violet)" }}
        >
          Recurring →
        </Link>
      </div>

      {/* Search bar */}
      <Card radius="md" className="flex items-center gap-3 px-4 py-3">
        <Search size={18} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
        <Input
          className="flex-1 h-auto border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-(--ink-3) text-(--ink) focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder="Search transactions..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setSearch(searchInput);
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
            className="h-6 w-6"
            aria-label="Clear search"
            onClick={() => {
              setSearchInput("");
              setSearch("");
            }}
          >
            <X size={16} style={{ color: "var(--ink-3)" }} />
          </Button>
        )}
      </Card>

      {/* Type filter chips */}
      <FilterChips chips={TYPE_CHIPS} active={typeFilter} onChange={setTypeFilter} />

      {/* Category chips (only visible when type is expense or all) */}
      {typeFilter !== "income" && typeFilter !== "transfer" && (
        <FilterChips
          chips={[{ label: "All Categories", value: "" }, ...CAT_CHIPS]}
          active={catFilter}
          onChange={setCatFilter}
        />
      )}

      {/* Transaction list grouped by day */}
      {isLoading ? (
        <div className="flex flex-col gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28 rounded-full" />
              <Skeleton className="h-16 w-full rounded-[var(--r-md)]" />
              <Skeleton className="h-16 w-full rounded-[var(--r-md)]" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card radius="lg" className="flex flex-col items-center justify-center gap-3 py-16">
          <div
            className="w-14 h-14 rounded-full grid place-items-center"
            style={{ background: "var(--card-2)" }}
          >
            <Search size={24} style={{ color: "var(--ink-3)" }} />
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>
            No transactions found
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <DayGroup key={group.date.toISOString()} date={group.date} transactions={group.items} />
          ))}
          {data && data.total > (data.data?.length ?? 0) && (
            <Button
              variant="secondary"
              onClick={() => setLimit((current) => current + 50)}
              className="w-full h-auto py-3 rounded-(--r-md) font-semibold"
              style={{ color: "var(--violet)" }}
            >
              Load more ({data.total - (data.data?.length ?? 0)} remaining)
            </Button>
          )}
        </div>
      )}

    </div>
  );
}
