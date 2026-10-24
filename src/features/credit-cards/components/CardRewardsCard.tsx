"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/_ui/Input";
import { Skeleton } from "@/components/_ui/Skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import { dollarsToCents } from "@/lib/utils";
import { type IRewardRule } from "@/types/models";
import { useCardRewards, useSaveCardRewardRule, type CardRewardCycle } from "../hooks/useCardRewards";

interface Props {
  accountId: string;
}

const labelStyle = { font: "var(--text-label)", color: "var(--ink-2)" } as const;

function earnedText(cycle: CardRewardCycle, formatCurrency: (cents: number) => string) {
  return cycle.unit === "points" ? `${cycle.earned.toLocaleString("en-IN")} points` : formatCurrency(cycle.earned);
}

type Draft = { kind: "cashback" | "points"; baseRate: string; cap: string; pointValue: string; categoryRates: { category: string; rate: string }[] };

function toDraft(rule: NonNullable<ReturnType<typeof useCardRewards>["data"]>["rule"]): Draft {
  return {
    kind: rule?.kind ?? "cashback",
    baseRate: rule ? String(rule.baseRate) : "1",
    cap: rule?.cap != null ? String(rule.kind === "cashback" ? rule.cap / 100 : rule.cap) : "",
    pointValue: rule?.pointValue != null ? String(rule.pointValue / 100) : "",
    categoryRates: (rule?.categoryRates ?? []).map(c => ({ category: c.category, rate: String(c.rate) })),
  };
}

function toRule(d: Draft): IRewardRule {
  return {
    kind: d.kind,
    baseRate: Number(d.baseRate) || 0,
    categoryRates: d.categoryRates.filter(c => c.category.trim()).map(c => ({ category: c.category.trim(), rate: Number(c.rate) || 0 })),
    ...(d.cap ? { cap: d.kind === "cashback" ? dollarsToCents(Number(d.cap)) : Math.round(Number(d.cap)) } : {}),
    ...(d.kind === "points" && d.pointValue ? { pointValue: dollarsToCents(Number(d.pointValue)) } : {}),
  };
}

// What the card earns: this cycle's estimate and the rule behind it, with a
// small form to change it. Estimates come from src/lib/card-rewards.ts.
export function CardRewardsCard({ accountId }: Props) {
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useCardRewards(accountId);
  const save = useSaveCardRewardRule(accountId);
  const [draft, setDraft] = useState<Draft | null>(null);

  if (isLoading || !data) return <Skeleton className="h-40 rounded-(--r-lg)" />;

  const current = data.cycles[0];
  const editing = draft !== null;

  function startEditing() {
    setDraft(toDraft(data!.rule));
  }

  async function submit() {
    if (!draft) return;
    await save.mutateAsync(toRule(draft));
    setDraft(null);
  }

  return (
    <section>
      <div className="section-head">
        <h2>Rewards</h2>
        {!editing && (
          <Button type="button" variant="secondary" className="h-9 px-4 rounded-full font-semibold" onClick={startEditing}>
            {data.rule ? "Edit rule" : "Set up"}
          </Button>
        )}
      </div>

      <div className="rounded-(--r-lg) p-5 flex flex-col gap-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
        {!editing && !data.rule && (
          <div style={labelStyle}>Add what this card earns, as cashback or points, to see an estimate for each billing cycle.</div>
        )}

        {!editing && data.rule && data.reason === "billing_cycle_not_set" && (
          <div style={labelStyle}>Set the statement close day on this card to see what it earns each cycle.</div>
        )}

        {!editing && data.rule && current && (
          <>
            <div>
              <div style={labelStyle}>Earned this cycle</div>
              <div className="tnum mt-1" style={{ font: "var(--text-stat)", color: "var(--ink)" }}>{earnedText(current, formatCurrency)}</div>
              {current.unit === "points" && <div style={labelStyle}>about {formatCurrency(current.value)}</div>}
              {current.capReached && <div style={{ ...labelStyle, color: "var(--ink-2)" }}>Cycle cap reached</div>}
            </div>
            <div style={labelStyle}>
              {data.rule.kind === "cashback"
                ? `${data.rule.baseRate}% cashback`
                : `${data.rule.baseRate} points per ${formatCurrency(10000)}`}
              {data.rule.categoryRates.length > 0 && ` · ${data.rule.categoryRates.length} category rate${data.rule.categoryRates.length === 1 ? "" : "s"}`}
            </div>
            <div className="inset-group">
              {data.cycles.map(c => (
                <div key={c.periodStart} className="flex items-center justify-between py-2" style={{ font: "var(--text-body)" }}>
                  <span>{c.label}{c.isCurrent ? " (open)" : ""}</span>
                  <span className="tnum">{earnedText(c, formatCurrency)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {editing && draft && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span style={labelStyle}>Reward type</span>
              <div className="flex gap-2">
                {(["cashback", "points"] as const).map(k => (
                  <Button key={k} type="button" variant={draft.kind === k ? "default" : "secondary"} className="h-9 rounded-full px-4 font-semibold" onClick={() => setDraft({ ...draft, kind: k })}>
                    {k === "cashback" ? "Cashback" : "Points"}
                  </Button>
                ))}
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span style={labelStyle}>{draft.kind === "cashback" ? "Base rate (percent of spend)" : "Base rate (points per 100 rupees)"}</span>
              <Input type="number" min="0" step="0.01" value={draft.baseRate} onChange={e => setDraft({ ...draft, baseRate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span style={labelStyle}>{draft.kind === "cashback" ? "Cap per cycle (rupees, optional)" : "Cap per cycle (points, optional)"}</span>
              <Input type="number" min="0" step="1" value={draft.cap} onChange={e => setDraft({ ...draft, cap: e.target.value })} />
            </label>
            {draft.kind === "points" && (
              <label className="flex flex-col gap-1.5">
                <span style={labelStyle}>Value of one point (rupees, optional)</span>
                <Input type="number" min="0" step="0.01" placeholder="0.25" value={draft.pointValue} onChange={e => setDraft({ ...draft, pointValue: e.target.value })} />
              </label>
            )}
            <div className="flex flex-col gap-2">
              <span style={labelStyle}>Category rates</span>
              {draft.categoryRates.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input placeholder="Category, e.g. fuel" value={c.category} onChange={e => setDraft({ ...draft, categoryRates: draft.categoryRates.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)) })} />
                  <Input className="w-24" type="number" min="0" step="0.01" value={c.rate} onChange={e => setDraft({ ...draft, categoryRates: draft.categoryRates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} />
                  <Button type="button" variant="ghost" aria-label="Remove category rate" onClick={() => setDraft({ ...draft, categoryRates: draft.categoryRates.filter((_, j) => j !== i) })}>×</Button>
                </div>
              ))}
              <Button type="button" variant="secondary" className="h-9 rounded-full px-4 font-semibold self-start" onClick={() => setDraft({ ...draft, categoryRates: [...draft.categoryRates, { category: "", rate: "" }] })}>
                Add a category rate
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button type="button" className="h-10 rounded-full px-5 font-semibold" disabled={save.isPending} onClick={() => void submit()}>Save</Button>
              <Button type="button" variant="secondary" className="h-10 rounded-full px-5 font-semibold" onClick={() => setDraft(null)}>Cancel</Button>
              {data.rule && (
                <Button type="button" variant="ghost" className="h-10 rounded-full px-5 font-semibold" disabled={save.isPending} onClick={() => void save.mutateAsync(null).then(() => setDraft(null))}>
                  Remove rule
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
