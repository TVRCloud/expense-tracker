"use client";

import { useState, type CSSProperties } from "react";
import { BellOff, Check, Copy, Flag, ShieldCheck, TrendingUp, TriangleAlert, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { formatMinor } from "@/lib/money-format";
import {
  useAnomalies,
  useAnomalySettings,
  useAnswerAnomaly,
  useChangeAnomalySettings,
  type Anomaly,
  type AnomalyAction,
  type AnomalyKind,
} from "../hooks/useAnomalies";

const KIND: Record<AnomalyKind, { icon: typeof TriangleAlert; title: string }> = {
  large_spend: { icon: TriangleAlert, title: "Large spend" },
  duplicate_charge: { icon: Copy, title: "Possible duplicate charge" },
  category_jump: { icon: TrendingUp, title: "Higher than usual" },
};

const STATUS_LABEL: Record<Anomaly["status"], string> = {
  open: "Waiting for you",
  confirmed_mine: "You said it was you",
  reported: "Reported",
  dismissed: "Dismissed",
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** One plain sentence about what was unusual, from the numbers the rule kept. */
export function describe(a: Anomaly): string {
  const money = (n: number) => formatMinor(n, a.currency);
  if (a.kind === "large_spend") {
    return `${money(a.amount)} on ${a.category}. Your usual is about ${money(num(a.data.typical))}.`;
  }
  if (a.kind === "duplicate_charge") {
    return `${money(a.amount)} was charged twice within ${num(a.data.windowMinutes) || 10} minutes.`;
  }
  return `${money(a.amount)} so far this month on ${a.category}, against about ${money(num(a.data.baseline))} by this point in a usual month.`;
}

function AlertRow({ item, onMute }: { item: Anomaly; onMute: (category: string) => void }) {
  const answer = useAnswerAnomaly();
  const { icon: Icon, title } = KIND[item.kind];
  const open = item.status === "open";

  function act(status: AnomalyAction, message: string) {
    answer.mutate(
      { id: item.id, status },
      {
        onError: () => toast.error("Could not save your answer"),
        // The expense may refuse the tag (a loan or card payment row, or ten tags already).
        onSuccess: (res) => status === "report" && toast(res.data.data.tagged ? message : "Reported, not tagged"),
      }
    );
    if (status !== "report") toast(message);
  }

  return (
    <div className="flex items-start gap-3.5 px-4 py-3.5">
      <div
        className="w-11 h-11 rounded-full grid place-items-center flex-none"
        style={{ background: "var(--card-2)", color: open ? "var(--red)" : "var(--ink-3)" }}
      >
        <Icon size={19} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[15px]" style={{ color: "var(--ink)" }}>
          {title}
          <span className="font-normal" style={{ color: "var(--ink-3)" }}> · {item.category}</span>
        </div>
        <div className="text-[13px] mt-0.5" style={{ color: "var(--ink-2)" }}>{describe(item)}</div>
        <div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>
          {format(new Date(item.createdAt), "d MMM, HH:mm")}
          {!open && ` · ${STATUS_LABEL[item.status]}`}
        </div>
        {open && (
          <div className="flex flex-wrap gap-2 mt-2.5">
            <Button size="sm" variant="outline" onClick={() => act("this_was_me", "Marked as you")}>
              <Check /> This was me
            </Button>
            {item.transactionId && (
              <Button size="sm" variant="outline" onClick={() => act("report", "Reported")}>
                <Flag /> Report
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => act("dismiss", "Dismissed")}>
              <X /> Dismiss
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onMute(item.category)}>
              <BellOff /> Mute {item.category}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Settings() {
  const { data } = useAnomalySettings();
  const change = useChangeAnomalySettings();
  const [draft, setDraft] = useState("");
  if (!data) return <Skeleton className="h-[120px] rounded-(--r-lg)" />;

  function addMute() {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    change.mutate({ add: [name] }, { onError: () => toast.error("Could not mute that category") });
  }

  return (
    <div className="rounded-(--r-lg) p-4 flex flex-col gap-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-center gap-3">
        <ShieldCheck size={20} style={{ color: "var(--ink-2)" }} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[15px]" style={{ color: "var(--ink)" }}>Unusual spend alerts</div>
          <div className="text-xs" style={{ color: "var(--ink-3)" }}>
            A big one-off spend, a charge repeated within minutes, or a category far above its usual month.
          </div>
        </div>
        <Switch
          aria-label="Unusual spend alerts"
          checked={data.enabled}
          onCheckedChange={(enabled) => change.mutate({ enabled }, { onError: () => toast.error("Could not change this setting") })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {data.mutedCategories.length === 0 && (
          <span className="text-xs" style={{ color: "var(--ink-3)" }}>No muted categories</span>
        )}
        {data.mutedCategories.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Unmute ${c}`}
            className="inline-flex items-center gap-1 rounded-full px-3 h-8 text-[13px]"
            style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
            onClick={() => change.mutate({ remove: [c] }, { onError: () => toast.error("Could not unmute that category") })}
          >
            {c} <X size={13} />
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addMute();
        }}
      >
        <Input
          aria-label="Category to mute"
          placeholder="Mute a category"
          maxLength={40}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!draft.trim() || change.isPending}>Mute</Button>
      </form>
    </div>
  );
}

export function AnomaliesClient() {
  const [tab, setTab] = useState<"open" | "all">("open");
  const { data, isLoading } = useAnomalies(tab);
  const change = useChangeAnomalySettings();
  const items = data?.data ?? [];

  function mute(category: string) {
    change.mutate({ add: [category] }, { onError: () => toast.error("Could not mute that category") });
    toast(`Muted ${category}`);
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Alerts"
        subtitle={data && data.openCount > 0 ? `${data.openCount} waiting for your answer` : "Unusual spending, when it happens"}
      />
      <Settings />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "all")}>
        <TabsList>
          <TabsTrigger value="open">Waiting</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="inset-group">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[88px] rounded-none" />)}
        </div>
      ) : items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-(--r-lg) py-16 text-center px-6"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <ShieldCheck size={28} style={{ color: "var(--ink-3)" }} />
          <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
            {tab === "open" ? "Nothing unusual right now" : "No alerts yet"}
          </p>
          <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
            We look at each new expense against your own usual spending.
          </p>
        </div>
      ) : (
        <div className="inset-group" style={{ "--inset": "74px" } as CSSProperties}>
          {items.map((a) => <AlertRow key={a.id} item={a} onMute={mute} />)}
        </div>
      )}
    </div>
  );
}
