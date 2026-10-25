"use client";

import { useState, type CSSProperties } from "react";
import { format } from "date-fns";
import { CalendarClock, Plus, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  HOLDING_KIND_LABELS,
  useArchiveHolding,
  useHoldings,
  useSetHoldingValue,
  type Holding,
  type HoldingKind,
} from "../hooks/useHoldings";
import { toMinor } from "../amount-input";
import { AddHolding } from "./AddHolding";

const day = (key: string) => format(new Date(`${key}T00:00:00`), "d MMM yyyy");
const tone = (n: number) => (n > 0 ? "var(--green)" : n < 0 ? "var(--red)" : "var(--ink-3)");

function GainLine({ gain, percent }: { gain: number; percent: number | null }) {
  const { formatCurrency } = useCurrency();
  const sign = gain > 0 ? "+" : gain < 0 ? "-" : "";
  return (
    <span className="tnum" style={{ color: tone(gain) }}>
      {sign}{formatCurrency(Math.abs(gain))}
      {percent !== null && ` (${sign}${Math.abs(percent)}%)`}
    </span>
  );
}

function HoldingRow({ h }: { h: Holding }) {
  const { formatCurrency } = useCurrency();
  const setValue = useSetHoldingValue();
  const archive = useArchiveHolding();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [asPrice, setAsPrice] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const canSetValue = h.kind !== "fixed_deposit";

  function save(e: React.FormEvent) {
    e.preventDefault();
    const body = asPrice ? { id: h.id, price: text.trim() } : { id: h.id, value: toMinor(text) ?? undefined };
    if (!asPrice && body.value === undefined) return toast.error("Enter the value as an amount");
    setValue.mutate(body, {
      onSuccess: () => {
        setEditing(false);
        setText("");
        toast.success("Value updated");
      },
      onError: (err) => {
        const m = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
        toast.error(m && m !== "Validation failed" ? m : "Could not update the value");
      },
    });
  }

  const sub = [
    h.units ? `${h.units} units` : null,
    h.fd ? `${(h.fd.rateBps / 100).toFixed(2)}% to ${day(h.fd.maturityDay)}${h.fd.matured ? " (matured)" : ""}` : null,
    h.sip?.active && h.sip.nextDue ? `SIP ${formatCurrency(h.sip.amount)} next on ${day(h.sip.nextDue)}` : null,
  ].filter(Boolean);

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-3 min-h-[44px]">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium truncate" style={{ color: "var(--ink)" }}>{h.name}</div>
          {sub.length > 0 && <div className="text-xs mt-0.5 truncate" style={{ color: "var(--ink-3)" }}>{sub.join(", ")}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="tnum text-[15px]" style={{ color: "var(--ink)" }}>{formatCurrency(h.value)}</div>
          <div className="text-xs"><GainLine gain={h.gain} percent={h.gainPercent} /></div>
        </div>
        <button
          type="button"
          aria-label={`Remove ${h.name}`}
          className="w-11 h-11 grid place-items-center rounded-full shrink-0"
          onClick={() => setConfirming(true)}
        >
          <X size={18} />
        </button>
      </div>

      {canSetValue && !editing && (
        <button type="button" className="text-xs underline-offset-2 hover:underline" style={{ color: "var(--ink-2)" }} onClick={() => setEditing(true)}>
          Update value{h.valueUpdatedAt ? ` (last ${format(new Date(h.valueUpdatedAt), "d MMM")})` : ""}
        </button>
      )}
      {canSetValue && editing && (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={asPrice ? "Price per unit" : "Value today"}
            inputMode="decimal"
            placeholder={asPrice ? "Price per unit" : "Worth today"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-40"
            autoFocus
          />
          {h.units && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAsPrice((v) => !v)}>
              {asPrice ? "Enter the total instead" : "Enter a price per unit"}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={setValue.isPending}>Save</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {h.name}?</AlertDialogTitle>
            <AlertDialogDescription>It stops counting in your net worth. Your accounts and transactions are not touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archive.mutate(h.id, { onError: () => toast.error("Could not remove this holding") })}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function InvestmentsClient() {
  const { formatCurrency } = useCurrency();
  const { data, isLoading, isError, refetch } = useHoldings();
  const [adding, setAdding] = useState(false);

  if (isLoading) {
    return (
      <div className="page-stack">
        <PageHeader title="Investments" subtitle="What you hold and how it is doing" />
        <Skeleton className="h-36 rounded-(--r-lg)" />
        <Skeleton className="h-40 rounded-(--r-lg)" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="page-stack">
        <PageHeader title="Investments" subtitle="What you hold and how it is doing" />
        <div className="rounded-(--r-lg) p-6 text-center space-y-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <p style={{ color: "var(--ink-2)" }}>Could not load your holdings.</p>
          <Button onClick={() => refetch()}>Try again</Button>
        </div>
      </div>
    );
  }

  const groups = (Object.keys(HOLDING_KIND_LABELS) as HoldingKind[])
    .map((kind) => ({ kind, rows: data.holdings.filter((h) => h.kind === kind) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="page-stack">
      <PageHeader
        title="Investments"
        subtitle="What you hold and how it is doing"
        actions={!adding ? <Button onClick={() => setAdding(true)}><Plus size={16} /> Add holding</Button> : undefined}
      />

      {adding && <AddHolding onDone={() => setAdding(false)} />}

      {data.holdings.length === 0 ? (
        !adding && (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-(--r-lg) py-12 text-center px-6"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
          >
            <TrendingUp size={28} style={{ color: "var(--ink-3)" }} />
            <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>No holdings yet</p>
            <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
              Add a fund, a share, gold or a fixed deposit and it counts in your net worth.
            </p>
          </div>
        )
      ) : (
        <>
          <div className="rounded-(--r-lg) p-5 space-y-1" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
            <div className="text-xs" style={{ color: "var(--ink-3)" }}>Worth today</div>
            <div className="tnum" style={{ font: "var(--text-display)", color: "var(--ink)" }}>{formatCurrency(data.totals.value)}</div>
            <div className="text-sm"><GainLine gain={data.totals.gain} percent={data.totals.gainPercent} /></div>
            <div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatCurrency(data.totals.invested)} put in</div>
          </div>

          {data.upcomingSips.length > 0 && (
            <section className="space-y-2">
              <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>SIPs coming up</h2>
              <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
                {data.upcomingSips.slice(0, 5).map((s) => (
                  <div key={`${s.holdingId}-${s.date}`} className="flex items-center gap-3 px-4 min-h-[48px] py-2">
                    <CalendarClock size={18} style={{ color: "var(--ink-3)" }} aria-hidden />
                    <div className="flex-1 min-w-0 text-[15px] truncate" style={{ color: "var(--ink)" }}>{s.name}</div>
                    <div className="text-xs" style={{ color: "var(--ink-3)" }}>{day(s.date)}</div>
                    <div className="tnum text-[15px]" style={{ color: "var(--ink)" }}>{formatCurrency(s.amount)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {groups.map((g) => {
            const row = data.byKind.find((k) => k.kind === g.kind);
            return (
              <section key={g.kind} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>{HOLDING_KIND_LABELS[g.kind]}</h2>
                  {row && <span className="tnum text-sm" style={{ color: "var(--ink-3)" }}>{formatCurrency(row.value)}</span>}
                </div>
                <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
                  {g.rows.map((h) => <HoldingRow key={h.id} h={h} />)}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
