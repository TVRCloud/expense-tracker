"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRightLeft, ChevronLeft, ChevronRight, Copy, Mails, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { formatMinor } from "@/lib/money-format";
import { getCategoryColor } from "@/lib/category-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  useAssignEnvelopes,
  useCopyEnvelopePlan,
  useEnvelopePlan,
  useMoveEnvelopeMoney,
  useSetEnvelopeMode,
  type EnvelopePlan,
  type EnvelopeRow,
} from "../hooks/useEnvelopes";

// "2026-10" <-> a month name, and the month before or after one.
const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
function shiftMonth(m: string, by: number) {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Typed text to minor units of the base currency; null when it is not a usable amount.
function toMinor(text: string, exponent: number): number | null {
  const n = Number(text.replace(/,/g, "").trim());
  if (text.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  const minor = Math.round(n * 10 ** exponent);
  return Number.isSafeInteger(minor) && minor <= 1e13 ? minor : null;
}
const toText = (minor: number, exponent: number) => String(Number((minor / 10 ** exponent).toFixed(exponent)));

// An amount that is edited in place and saved when the field is left or Enter is pressed.
function AmountField({ label, value, exponent, onSave, disabled }: { label: string; value: number; exponent: number; onSave: (minor: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(toText(value, exponent));
  useEffect(() => setText(toText(value, exponent)), [value, exponent]);
  function commit() {
    const minor = toMinor(text, exponent);
    if (minor === null) return setText(toText(value, exponent));
    if (minor !== value) onSave(minor);
  }
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="tnum w-28 text-right"
    />
  );
}

// How the income is shared out: one segment per envelope, the rest left open.
function AllocationBar({ plan }: { plan: EnvelopePlan }) {
  const total = Math.max(plan.income, plan.assigned, 1);
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }} role="img" aria-label="How your expected income is assigned">
      {plan.envelopes
        .filter((e) => e.assigned > 0)
        .map((e) => (
          <div key={e.category} title={`${e.category}: ${formatMinor(e.assigned, plan.currency)}`} style={{ width: `${(e.assigned / total) * 100}%`, background: getCategoryColor(e.category) }} />
        ))}
    </div>
  );
}

function MoveDialog({ plan, from, onClose }: { plan: EnvelopePlan; from: EnvelopeRow | null; onClose: () => void }) {
  const move = useMoveEnvelopeMoney();
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [overdraw, setOverdraw] = useState(false);
  useEffect(() => {
    setTo("");
    setText("");
    setOverdraw(false);
  }, [from?.category]);
  if (!from) return null;
  const others = plan.envelopes.filter((e) => e.category !== from.category);
  const minor = toMinor(text, plan.exponent);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to || !minor || minor < 1) return;
    move.mutate(
      { month: plan.month, from: from.category, to, amount: minor, allowOverdraw: overdraw || undefined },
      { onSuccess: onClose, onError: (err) => toast.error(err.message) }
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Move money from {from.category}</DialogTitle>
            <DialogDescription>
              {formatMinor(from.assigned, plan.currency)} assigned, {formatMinor(from.spent, plan.currency)} spent.
            </DialogDescription>
          </DialogHeader>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger aria-label="Move to"><SelectValue placeholder="Move to…" /></SelectTrigger>
            <SelectContent>
              {others.map((e) => (
                <SelectItem key={e.category} value={e.category}>{e.category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input aria-label="Amount to move" inputMode="decimal" placeholder="Amount" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <label className="flex items-center gap-3 text-sm" style={{ color: "var(--ink-2)" }}>
            <Switch checked={overdraw} onCheckedChange={setOverdraw} aria-label="Allow taking money that is already spent" />
            Allow taking money that is already spent
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={move.isPending || !to || !minor}>Move</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EnvelopesClient() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const { data: plan, isLoading } = useEnvelopePlan(month);
  const assign = useAssignEnvelopes();
  const copy = useCopyEnvelopePlan();
  const setMode = useSetEnvelopeMode();
  const [moving, setMoving] = useState<EnvelopeRow | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  if (isLoading || !plan) {
    return (
      <div className="page-stack">
        <PageHeader title="Envelopes" subtitle="Give every bit of income a job" />
        <Skeleton className="h-44 rounded-(--r-lg)" />
        <Skeleton className="h-40 rounded-(--r-lg)" />
      </div>
    );
  }

  const fmt = (n: number) => formatMinor(n, plan.currency);
  const save = (body: Parameters<typeof assign.mutate>[0]) => assign.mutate(body, { onError: (err) => toast.error(err.message) });

  if (!plan.enabled) {
    return (
      <div className="page-stack">
        <PageHeader title="Envelopes" subtitle="Give every bit of income a job" />
        <div className="flex flex-col items-center justify-center gap-3 rounded-(--r-lg) py-12 text-center px-6" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <Mails size={28} style={{ color: "var(--ink-3)" }} />
          <p style={{ font: "var(--text-body)", color: "var(--ink)" }}>Plan the month before it starts</p>
          <p className="max-w-md" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
            Say what you expect to earn, then assign it to envelopes until nothing is left unplanned. Your budgets stay as they are, and you can turn this off at any time.
          </p>
          <Button onClick={() => setMode.mutate(true, { onError: (err) => toast.error(err.message) })} disabled={setMode.isPending}>
            Turn on envelopes
          </Button>
        </div>
      </div>
    );
  }

  const current = plan.month;
  const exponent = plan.exponent;
  const empty = plan.envelopes.length === 0;

  function addEnvelope(e: React.FormEvent) {
    e.preventDefault();
    const minor = toMinor(amount === "" ? "0" : amount, exponent);
    if (!name.trim() || minor === null) return;
    save({ month: current, assign: [{ category: name.trim(), assigned: minor }] });
    setName("");
    setAmount("");
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Envelopes"
        subtitle="Give every bit of income a job"
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(current, -1))}>
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-36 text-center text-[15px] font-medium" style={{ color: "var(--ink)" }}>{monthLabel(current)}</span>
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(current, 1))}>
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />

      <div className="rounded-(--r-lg) p-5 space-y-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm" style={{ color: plan.overAssigned ? "var(--red)" : "var(--ink-3)" }}>
              {plan.overAssigned ? "Assigned more than you expect" : "Left to assign"}
            </div>
            <div className="tnum" style={{ font: "var(--text-display)", color: plan.overAssigned ? "var(--red)" : "var(--ink)" }}>
              {fmt(Math.abs(plan.unassigned))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-3)" }}>
            Expected income
            <AmountField label="Expected income" value={plan.income} exponent={plan.exponent} onSave={(income) => save({ month: current, income })} disabled={assign.isPending} />
          </label>
        </div>
        <AllocationBar plan={plan} />
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>
          {fmt(plan.assigned)} of {fmt(plan.income)} assigned
        </div>
      </div>

      {empty ? (
        <div className="flex flex-col items-center gap-2 rounded-(--r-lg) py-10 text-center px-6" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>No envelopes in {monthLabel(current)} yet</p>
          {plan.hasPrevious && (
            <Button variant="outline" disabled={copy.isPending} onClick={() => copy.mutate({ month: current }, { onError: (err) => toast.error(err.message) })}>
              <Copy size={16} /> Copy {monthLabel(plan.previousMonth)}
            </Button>
          )}
        </div>
      ) : (
        <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
          {plan.envelopes.map((e) => {
            const used = e.assigned > 0 ? Math.min(100, (e.spent / e.assigned) * 100) : e.spent > 0 ? 100 : 0;
            return (
              <div key={e.category} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: getCategoryColor(e.category) }} />
                  <div className="flex-1 min-w-0 text-[15px] font-medium truncate" style={{ color: "var(--ink)" }}>{e.category}</div>
                  <AmountField label={`${e.category} assigned`} value={e.assigned} exponent={plan.exponent} onSave={(assigned) => save({ month: current, assign: [{ category: e.category, assigned }] })} disabled={assign.isPending} />
                  <button type="button" aria-label={`Move money from ${e.category}`} className="w-10 h-10 grid place-items-center rounded-full" disabled={plan.envelopes.length < 2} onClick={() => setMoving(e)}>
                    <ArrowRightLeft size={16} />
                  </button>
                  <button type="button" aria-label={`Remove ${e.category}`} className="w-10 h-10 grid place-items-center rounded-full" onClick={() => save({ month: current, remove: [e.category] })}>
                    <X size={16} />
                  </button>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                  <div className="h-full rounded-full" style={{ width: `${used}%`, background: e.overspent ? "var(--red)" : getCategoryColor(e.category) }} />
                </div>
                <div className="flex justify-between text-xs tnum" style={{ color: "var(--ink-3)" }}>
                  <span>{fmt(e.spent)} spent</span>
                  <span style={{ color: e.overspent ? "var(--red)" : undefined }}>{e.overspent ? `${fmt(-e.left)} over` : `${fmt(e.left)} left`}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {plan.suggested.length > 0 && (
        <section className="space-y-2">
          <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>From your budgets</h2>
          <div className="flex flex-wrap gap-2">
            {plan.suggested.map((s) => (
              <Button key={s.category} variant="outline" size="sm" onClick={() => save({ month: current, assign: [{ category: s.category, assigned: s.limitAmount }] })}>
                <Plus size={14} /> {s.category} · {fmt(s.limitAmount)}
              </Button>
            ))}
          </div>
        </section>
      )}

      <form onSubmit={addEnvelope} className="flex flex-wrap items-center gap-2">
        <Input aria-label="Envelope name" placeholder="New envelope, like Groceries" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-40" maxLength={100} />
        <Input aria-label="Amount to assign" placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
        <Button type="submit" disabled={assign.isPending || !name.trim()}>
          <Plus size={16} /> Add
        </Button>
      </form>

      {plan.moves.length > 0 && (
        <section className="space-y-2">
          <h2 style={{ font: "var(--text-h2)", color: "var(--ink)" }}>Recent moves</h2>
          <div className="inset-group" style={{ "--inset": "16px" } as CSSProperties}>
            {plan.moves.map((m, i) => (
              <div key={`${m.at}-${i}`} className="flex items-center gap-3 px-4 min-h-[48px] py-2 text-[15px]" style={{ color: "var(--ink)" }}>
                <div className="flex-1 min-w-0 truncate">{m.from} to {m.to}</div>
                <div className="tnum">{fmt(m.amount)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div>
        <Button variant="ghost" size="sm" onClick={() => setMode.mutate(false, { onError: (err) => toast.error(err.message) })} disabled={setMode.isPending}>
          Turn off envelopes
        </Button>
      </div>

      <MoveDialog plan={plan} from={moving} onClose={() => setMoving(null)} />
    </div>
  );
}
