"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Download, Printer, Receipt } from "lucide-react";
import { toast } from "sonner";
import { formatMinor, formatMinorCompact } from "@/lib/money-format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { useChangeDeductibleCategories, useTaxSummary, type TaxMonth, type TaxRow } from "../hooks/useTax";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (key: string) => MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key;

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs" style={{ color: "var(--ink-3)" }}>{label}</div>
      <div className="tnum text-[17px] font-medium truncate" style={{ color: tone ?? "var(--ink)" }}>{value}</div>
    </div>
  );
}

// Twelve bars, April to March: spending in the ink colour, the deductible part
// laid over it in green, so the gap is what is not claimable.
function MonthBars({ months, currency }: { months: TaxMonth[]; currency: string }) {
  const formatCurrencyCompact = (n: number) => formatMinorCompact(n, currency);
  const top = Math.max(1, ...months.map((m) => m.expense));
  return (
    <div className="grid grid-cols-12 gap-1.5 items-end h-28" role="img" aria-label="Spending and deductible spending by month">
      {months.map((m) => {
        const spent = Math.max(0, m.expense);
        const claim = Math.min(spent, Math.max(0, m.deductible));
        return (
          <div key={m.month} className="flex flex-col items-center justify-end gap-1 h-full min-w-0" title={`${monthName(m.month)}: ${formatCurrencyCompact(m.expense)} spent, ${formatCurrencyCompact(m.deductible)} deductible`}>
            <div className="w-full relative rounded-t-[4px] overflow-hidden" style={{ height: `${(spent / top) * 100}%`, minHeight: spent > 0 ? 3 : 0, background: "var(--line)" }}>
              <div className="absolute bottom-0 inset-x-0" style={{ height: spent ? `${(claim / spent) * 100}%` : 0, background: "var(--green)" }} />
            </div>
            <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>{monthName(m.month)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Rows({ rows, currency }: { rows: TaxRow[]; currency: string }) {
  const formatCurrency = (n: number) => formatMinor(n, currency);
  return (
    <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
      {rows.map((r) => (
        <div key={r.category} className="flex items-center gap-3 px-4 min-h-[48px] py-2">
          <div className="flex-1 min-w-0 text-[15px] truncate capitalize" style={{ color: "var(--ink)" }}>{r.category}</div>
          <div className="tnum text-[15px]" style={{ color: "var(--ink)" }}>{formatCurrency(r.total)}</div>
        </div>
      ))}
    </div>
  );
}

export function TaxClient() {
  const [fy, setFy] = useState<number | undefined>(undefined);
  const { data, isLoading } = useTaxSummary(fy);
  const setCategories = useChangeDeductibleCategories();
  const [saving, setSaving] = useState<Set<string>>(new Set());

  // The print rule in globals.css only applies while this page is open.
  useEffect(() => {
    document.documentElement.dataset.print = "tax";
    return () => {
      delete document.documentElement.dataset.print;
    };
  }, []);

  if (isLoading || !data) {
    return (
      <div className="page-stack">
        <PageHeader title="Tax" subtitle="Your financial year, ready for your accountant" />
        <Skeleton className="h-44 rounded-(--r-lg)" />
        <Skeleton className="h-40 rounded-(--r-lg)" />
      </div>
    );
  }

  const marked = new Set(data.deductibleCategories);
  const nothing = data.count === 0;
  const formatCurrency = (n: number) => formatMinor(n, data.currency);

  // Every category with spend this year, plus any saved one with none, so a
  // saved category can always be switched off.
  const switches = new Map(data.expenseByCategory.map((r) => [r.category.toLowerCase(), r]));
  for (const name of data.deductibleCategories) {
    if (!switches.has(name)) switches.set(name, { category: name, total: 0 });
  }

  // Every switch stays off-limits until its own save settles, however many others are saving.
  async function toggle(category: string, on: boolean) {
    const name = category.toLowerCase();
    setSaving((s) => new Set(s).add(name));
    try {
      await setCategories.mutateAsync(on ? { add: [name] } : { remove: [name] });
    } catch {
      toast.error("Could not save this change");
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(name);
        return next;
      });
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Tax"
        subtitle={`Financial year ${data.label}, 1 April to 31 March`}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <Select value={String(data.fy)} onValueChange={(v) => setFy(Number(v))}>
              <SelectTrigger aria-label="Financial year" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{`${y}-${String((y + 1) % 100).padStart(2, "0")}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="outline">
              <a href={`/api/tax/export?fy=${data.fy}`} download>
                <Download size={16} /> CSV
              </a>
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </Button>
          </div>
        }
      />

      {nothing ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-(--r-lg) py-12 text-center px-6"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <Receipt size={28} style={{ color: "var(--ink-3)" }} />
          <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>Nothing recorded in {data.label}</p>
          <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Pick another year, or add income and spending to see the summary.</p>
        </div>
      ) : (
        <>
          <div className="rounded-(--r-lg) p-5 space-y-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
            <div>
              <div className="text-sm" style={{ color: "var(--ink-3)" }}>Deductible spending</div>
              <div className="tnum" style={{ font: "var(--text-display)", color: "var(--ink)" }}>{formatCurrency(data.deductible.total)}</div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Figure label="Income" value={formatCurrency(data.income)} />
              <Figure label="Spending" value={formatCurrency(data.expense)} />
              <Figure label="Saved" value={formatCurrency(data.saved)} tone={data.saved < 0 ? "var(--red)" : undefined} />
            </div>
            <MonthBars months={data.byMonth} currency={data.currency} />
          </div>

          <section className="space-y-2">
            <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Deductible by category</h2>
            {data.deductible.byCategory.length > 0 ? (
              <Rows rows={data.deductible.byCategory} currency={data.currency} />
            ) : (
              <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Switch a category on below to count it as deductible.</p>
            )}
          </section>

          {data.incomeByCategory.length > 0 && (
            <section className="space-y-2">
              <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Income by category</h2>
              <Rows rows={data.incomeByCategory} currency={data.currency} />
            </section>
          )}

          <section className="space-y-2 print:hidden">
            <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>What counts as deductible</h2>
            <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
              {[...switches.values()].map((r) => (
                <label key={r.category} className="flex items-center gap-3 px-4 min-h-[52px] py-2">
                  <span className="flex-1 min-w-0 text-[15px] truncate capitalize" style={{ color: "var(--ink)" }}>{r.category}</span>
                  <span className="tnum text-sm" style={{ color: "var(--ink-3)" }}>{formatCurrency(r.total)}</span>
                  <Switch
                    checked={marked.has(r.category.toLowerCase())}
                    onCheckedChange={(on) => toggle(r.category, on)}
                    disabled={saving.has(r.category.toLowerCase())}
                    aria-label={`${r.category} is deductible`}
                  />
                </label>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
