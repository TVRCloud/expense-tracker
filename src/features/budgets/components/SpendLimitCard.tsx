"use client";

import { useState } from "react";
import { Gauge, Settings2 } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Progress } from "@/components/_ui/Progress";
import { Input } from "@/components/_ui/Input";
import { Switch } from "@/components/_ui/Switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BUDGET_CATEGORIES } from "@/features/budgets/schemas/budget.schema";
import {
  centsToInput,
  pausedUntilFor,
  rupeesToCents,
  spendLimitUpdateSchema,
  type LimitBar,
  type PauseChoice,
  type SpendLimitStatus,
} from "@/features/budgets/schemas/spend-limit.schema";
import { useSpendLimit, useUpdateSpendLimit } from "@/features/budgets/hooks/useSpendLimit";

const labelStyle = { font: "var(--text-label)", color: "var(--ink-2)" } as const;

function barColor(b: LimitBar, alertAt: number) {
  if (b.percent === null) return "var(--violet)";
  if (b.percent >= 100) return "var(--red)";
  if (b.percent >= alertAt) return "var(--amber)";
  return "var(--violet)";
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function SpendLimitCard() {
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useSpendLimit();
  const [open, setOpen] = useState(false);

  if (isLoading || !data) return <Skeleton className="h-36 rounded-(--r-lg)" />;

  const { today, week, settings, paused, safeToSpend } = data;
  const hasLimit = settings.dailyAmount !== null || settings.weeklyAmount !== null;

  return (
    <>
      <Card radius="lg" className="p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div style={{ font: "var(--text-body)", fontWeight: 600, color: "var(--ink)" }}>Spend limit</div>
            <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
              {paused && settings.pausedUntil
                ? `Paused until ${dayLabel(settings.pausedUntil)}`
                : "A soft daily and weekly limit. It warns, it never blocks."}
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full -mr-1.5" aria-label="Edit spend limit" onClick={() => setOpen(true)}>
            <Settings2 size={16} style={{ color: "var(--ink-3)" }} />
          </Button>
        </div>

        {!hasLimit ? (
          <div className="flex flex-col items-start gap-3">
            <div className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--card-2)" }}>
              <Gauge size={22} style={{ color: "var(--ink-2)" }} />
            </div>
            <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
              Set a daily amount to see how much is left to spend today.
            </p>
            <Button type="button" onClick={() => setOpen(true)} className="h-11 px-5 rounded-full font-semibold btn-interactive">
              Set a limit
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {settings.dailyAmount !== null && (
              <LimitRow
                title="Today"
                bar={today}
                alertAt={settings.alertAt}
                paused={paused}
                format={formatCurrency}
                limitedBy={settings.dailyAmount}
              />
            )}
            {settings.weeklyAmount !== null && (
              <LimitRow
                title="This week"
                bar={week}
                alertAt={settings.alertAt}
                paused={paused}
                format={formatCurrency}
                limitedBy={settings.weeklyAmount}
              />
            )}
          </div>
        )}

        {safeToSpend !== null && (
          <div className="tnum" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
            Safe to spend each day for the rest of the month:{" "}
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>{formatCurrency(safeToSpend)}</span>
          </div>
        )}
      </Card>

      {open && <SpendLimitDialog data={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function LimitRow({
  title, bar, alertAt, paused, format, limitedBy,
}: {
  title: string;
  bar: LimitBar;
  alertAt: number;
  paused: boolean;
  format: (cents: number) => string;
  limitedBy: number;
}) {
  // While paused the API reports no limit; show what was spent against the saved one.
  const limit = bar.limit ?? limitedBy;
  const left = limit - bar.spent;
  const over = left < 0;
  const pct = limit > 0 ? Math.min((bar.spent / limit) * 100, 100) : 0;
  return (
    <div className="flex flex-col gap-2" style={{ opacity: paused ? 0.6 : 1 }}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{title}</div>
          <div className="tnum truncate mt-1" style={{ font: "var(--text-stat)", letterSpacing: "-0.02em", color: over && !paused ? "var(--red)" : "var(--ink)" }}>
            {format(Math.abs(left))} <span style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>{over ? "over" : "left"}</span>
          </div>
        </div>
        <div className="tnum text-right" style={{ font: "var(--text-micro)", color: "var(--ink-3)" }}>
          {format(bar.spent)} of {format(limit)}
        </div>
      </div>
      <Progress
        value={pct}
        color={paused ? "var(--ink-3)" : barColor({ ...bar, percent: Math.round(pct) }, alertAt)}
        trackColor="var(--line)"
        height={6}
        aria-label={`${title} spend limit used`}
      />
    </div>
  );
}

function SpendLimitDialog({ data, onClose }: { data: SpendLimitStatus; onClose: () => void }) {
  const { settings } = data;
  const update = useUpdateSpendLimit();
  const [daily, setDaily] = useState(centsToInput(settings.dailyAmount));
  const [weekly, setWeekly] = useState(centsToInput(settings.weeklyAmount));
  const [alertAt, setAlertAt] = useState(settings.alertAt);
  const [excluded, setExcluded] = useState<string[]>(settings.excludeCategories);
  const [rollover, setRollover] = useState(settings.rollover);
  const [pause, setPause] = useState<PauseChoice>("keep");
  const [error, setError] = useState<string | null>(null);

  const dailyCents = rupeesToCents(daily);
  const weeklyCents = rupeesToCents(weekly);
  const dailyBad = daily !== "" && (dailyCents === null || Number.isNaN(dailyCents) || dailyCents <= 0);
  const weeklyBad = weekly !== "" && (weeklyCents === null || Number.isNaN(weeklyCents) || weeklyCents <= 0);
  const pausedNow = !!settings.pausedUntil && new Date(settings.pausedUntil).getTime() > Date.now();

  const toggle = (c: string) =>
    setExcluded((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const save = () => {
    // Same schema the server validates with. A blank amount clears that limit.
    const parsed = spendLimitUpdateSchema.safeParse({
      dailyAmount: dailyCents === null ? null : dailyCents,
      weeklyAmount: weeklyCents === null ? null : weeklyCents,
      alertAt,
      excludeCategories: excluded,
      rollover,
      pausedUntil: pausedUntilFor(pause),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the amounts");
      return;
    }
    setError(null);
    update.mutate(parsed.data, { onSuccess: onClose });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 gap-0 border-0 sm:max-w-lg" style={{ background: "var(--card)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)" }}>
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>Spend limit</DialogTitle>
          <DialogDescription style={{ color: "var(--ink-3)" }}>
            Leave an amount blank for no limit. Rent and other recurring bills never count.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5 px-6 pb-6 pt-3"
          onSubmit={(e) => { e.preventDefault(); if (!dailyBad && !weeklyBad) save(); }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="limit-daily" style={labelStyle}>Daily limit</Label>
              <Input id="limit-daily" type="number" min="0" step="0.01" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="e.g. 1000" autoFocus className="h-11" />
              {dailyBad && <span style={{ font: "var(--text-micro)", color: "var(--red)" }}>Enter an amount above zero</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="limit-weekly" style={labelStyle}>Weekly limit</Label>
              <Input id="limit-weekly" type="number" min="0" step="0.01" value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder="e.g. 5000" className="h-11" />
              {weeklyBad && <span style={{ font: "var(--text-micro)", color: "var(--red)" }}>Enter an amount above zero</span>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="limit-alert" style={labelStyle}>Warn me at {alertAt}%</Label>
            <input id="limit-alert" type="range" min={50} max={100} value={alertAt} onChange={(e) => setAlertAt(Number(e.target.value))} className="w-full" style={{ accentColor: "var(--violet)" }} />
          </div>

          <div className="flex flex-col gap-2">
            <Label style={labelStyle}>Do not count these categories</Label>
            <div className="flex flex-wrap gap-2">
              {BUDGET_CATEGORIES.map((c) => {
                const on = excluded.includes(c);
                return (
                  <Button
                    key={c}
                    type="button"
                    variant="ghost"
                    aria-pressed={on}
                    onClick={() => toggle(c)}
                    className="h-9 rounded-full px-3 capitalize"
                    style={on ? { background: "var(--violet)", color: "var(--violet-fg)" } : { background: "var(--card-2)", color: "var(--ink-2)" }}
                  >
                    {c}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="inset-group" style={{ background: "var(--card-2)" }}>
            <label className="flex items-center justify-between gap-3 px-4 min-h-12" style={{ font: "var(--text-label)", color: "var(--ink)" }}>
              Carry yesterday into today
              <Switch checked={rollover} onCheckedChange={setRollover} />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="limit-pause" style={labelStyle}>
              Pause the limit{pausedNow && settings.pausedUntil ? ` (paused until ${dayLabel(settings.pausedUntil)})` : ""}
            </Label>
            <Select value={pause} onValueChange={(v) => setPause(v as PauseChoice)}>
              <SelectTrigger id="limit-pause" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">{pausedNow ? "Keep paused" : "Do not pause"}</SelectItem>
                {pausedNow && <SelectItem value="resume">Resume now</SelectItem>}
                <SelectItem value="1">Pause for 1 day</SelectItem>
                <SelectItem value="3">Pause for 3 days</SelectItem>
                <SelectItem value="7">Pause for 1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <span role="alert" style={{ font: "var(--text-micro)", color: "var(--red)" }}>{error}</span>}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <Button type="button" variant="ghost" onClick={onClose} className="h-11 px-5 rounded-full font-semibold">Cancel</Button>
            <Button type="submit" disabled={update.isPending || dailyBad || weeklyBad} className="h-11 px-6 rounded-full font-semibold btn-interactive">
              {update.isPending ? "Saving..." : "Save limit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
