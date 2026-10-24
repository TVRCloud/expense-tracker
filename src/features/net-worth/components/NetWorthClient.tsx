"use client";

import { useState, type CSSProperties } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { Plus, Scale, X } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  useAddManualAsset,
  useManualAssets,
  useNetWorth,
  useRemoveManualAsset,
  type BreakdownRow,
  type NetWorthRange,
} from "../hooks/useNetWorth";

const RANGES: { label: string; value: NetWorthRange }[] = [
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
  { label: "1 year", value: "1y" },
  { label: "All", value: "all" },
];

const chartConfig = {
  netWorth: { label: "Net worth", color: "var(--violet)" },
} satisfies ChartConfig;

function Rows({ rows, negative }: { rows: BreakdownRow[]; negative?: boolean }) {
  const { formatCurrency } = useCurrency();
  return (
    <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 px-4 min-h-[56px] py-3">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-medium truncate" style={{ color: "var(--ink)" }}>{r.label}</div>
            {r.count > 1 && (
              <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>{r.count} items</div>
            )}
          </div>
          <div className="tnum text-[15px]" style={{ color: negative ? "var(--red)" : "var(--ink)" }}>
            {negative ? "-" : ""}{formatCurrency(r.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}

function OtherAssets() {
  const { formatCurrency } = useCurrency();
  const { data: assets = [] } = useManualAssets();
  const add = useAddManualAsset();
  const remove = useRemoveManualAsset();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const rupees = parseFloat(value);
    if (!name.trim() || !Number.isFinite(rupees) || rupees < 0) return;
    add.mutate(
      { name: name.trim(), kind: "other", value: Math.round(rupees * 100) },
      {
        onSuccess: () => {
          setName("");
          setValue("");
        },
        onError: () => toast.error("Could not add this asset"),
      }
    );
  }

  return (
    <section className="space-y-2">
      <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Other things you own</h2>
      {assets.length > 0 && (
        <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
          {assets.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 min-h-[56px] py-2">
              <div className="flex-1 min-w-0 text-[15px] font-medium truncate" style={{ color: "var(--ink)" }}>{a.name}</div>
              <div className="tnum text-[15px]" style={{ color: "var(--ink)" }}>{formatCurrency(a.value)}</div>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                className="w-11 h-11 grid place-items-center rounded-full"
                onClick={() => remove.mutate(a.id, { onError: () => toast.error("Could not remove this asset") })}
              >
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input aria-label="Asset name" placeholder="Gold, flat, car" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-40" maxLength={60} />
        <Input aria-label="Value in rupees" placeholder="Value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
        <Button type="submit" disabled={add.isPending}>
          <Plus size={16} /> Add
        </Button>
      </form>
    </section>
  );
}

export function NetWorthClient() {
  const [range, setRange] = useState<NetWorthRange>("90d");
  const { formatCurrency, formatCurrencyCompact } = useCurrency();
  const { data, isLoading } = useNetWorth(range);

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <PageHeader title="Net worth" subtitle="What you own minus what you owe" />
        <Skeleton className="h-48 rounded-(--r-lg)" />
        <Skeleton className="h-40 rounded-(--r-lg)" />
      </div>
    );
  }

  const empty = data.breakdown.assets.length === 0 && data.breakdown.liabilities.length === 0;
  const up = data.change.amount >= 0;
  const points = data.history.map((p) => ({ label: format(new Date(`${p.date}T00:00:00`), "d MMM"), netWorth: p.netWorth }));

  return (
    <div className="page-stack">
      <PageHeader title="Net worth" subtitle="What you own minus what you owe" />

      <div
        className="rounded-(--r-lg) p-5 space-y-1"
        style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="tnum" style={{ font: "var(--text-display)", color: data.netWorth < 0 ? "var(--red)" : "var(--ink)" }}>
          {formatCurrency(data.netWorth)}
        </div>
        {data.change.since && (
          <div className="text-sm" style={{ color: up ? "var(--green)" : "var(--red)" }}>
            {up ? "Up" : "Down"} {formatCurrency(Math.abs(data.change.amount))}
            {data.change.percent !== null && ` (${Math.abs(data.change.percent)}%)`} since {format(new Date(`${data.change.since}T00:00:00`), "d MMM")}
          </div>
        )}
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>
          {formatCurrency(data.assets)} owned, {formatCurrency(data.liabilities)} owed
        </div>
      </div>

      {empty ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-(--r-lg) py-12 text-center px-6"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <Scale size={28} style={{ color: "var(--ink-3)" }} />
          <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>Nothing to count yet</p>
          <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Add an account or a loan, or add something you own below.</p>
        </div>
      ) : (
        <>
          <Tabs value={range} onValueChange={(v) => setRange(v as NetWorthRange)}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r.value} value={r.value}>{r.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {points.length > 1 && (
            <ChartContainer config={chartConfig} className="h-48 w-full">
              <AreaChart data={points}>
                <defs>
                  <linearGradient id="netWorthPageFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-netWorth)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-netWorth)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 6" stroke="var(--line)" strokeOpacity={0.6} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={24} tick={{ fill: "var(--ink-3)", fontSize: 12, fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--ink-3)", fontSize: 11, fontWeight: 600 }} tickFormatter={(v: number) => formatCurrencyCompact(v)} width={52} />
                <ChartTooltip cursor={{ stroke: "var(--line)" }} content={<ChartTooltipContent formatter={(value) => `Net worth: ${formatCurrencyCompact(Number(value))}`} />} />
                <Area type="monotone" dataKey="netWorth" stroke="var(--color-netWorth)" strokeWidth={2.5} fill="url(#netWorthPageFill)" isAnimationActive animationDuration={800} animationEasing="ease-out" />
              </AreaChart>
            </ChartContainer>
          )}

          {data.breakdown.assets.length > 0 && (
            <section className="space-y-2">
              <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Owned</h2>
              <Rows rows={data.breakdown.assets} />
            </section>
          )}
          {data.breakdown.liabilities.length > 0 && (
            <section className="space-y-2">
              <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Owed</h2>
              <Rows rows={data.breakdown.liabilities} negative />
            </section>
          )}
        </>
      )}

      <OtherAssets />
    </div>
  );
}
