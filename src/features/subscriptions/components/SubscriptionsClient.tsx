"use client";

import { useState, type CSSProperties } from "react";
import { Check, Repeat, X, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  useSetSubscriptionStatus,
  useSubscriptions,
  type Subscription,
  type SubscriptionStatus,
} from "../hooks/useSubscriptions";

const TABS = [
  { label: "Active", value: "" },
  { label: "Dismissed", value: "dismissed" },
] as const;

const CADENCE_LABEL: Record<Subscription["cadence"], string> = {
  weekly: "every week",
  monthly: "every month",
  quarterly: "every 3 months",
  yearly: "every year",
};

function SubscriptionRow({ item }: { item: Subscription }) {
  const { formatCurrency } = useCurrency();
  const set = useSetSubscriptionStatus();

  function change(status: SubscriptionStatus, message: string) {
    set.mutate(
      { id: item.id, status },
      { onError: () => toast.error("Could not update this subscription") }
    );
    toast(message);
  }

  return (
    <div className="flex items-center gap-3.5 px-4 min-h-[72px] py-3">
      <div
        className="w-11 h-11 rounded-full grid place-items-center flex-none"
        style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
      >
        <Repeat size={19} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[15px] truncate" style={{ color: "var(--ink)" }}>
          {item.merchant}
        </div>
        <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>
          {formatCurrency(item.amount)} {CADENCE_LABEL[item.cadence]} · next {format(new Date(item.nextDate), "d MMM")}
          {item.status === "confirmed" && " · confirmed"}
        </div>
      </div>
      <div className="text-right flex-none mr-1">
        <div className="tnum" style={{ font: "var(--text-figure-sm)", fontSize: 15, color: "var(--ink)" }}>
          {formatCurrency(item.yearlyCost)}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-3)" }}>a year</div>
      </div>
      {item.status === "dismissed" ? (
        <button
          type="button"
          aria-label={`Restore ${item.merchant}`}
          className="w-11 h-11 grid place-items-center rounded-full"
          onClick={() => change("detected", "Restored")}
        >
          <Undo2 size={18} />
        </button>
      ) : (
        <div className="flex flex-none">
          {item.status !== "confirmed" && (
            <button
              type="button"
              aria-label={`Confirm ${item.merchant}`}
              className="w-11 h-11 grid place-items-center rounded-full"
              onClick={() => change("confirmed", "Confirmed")}
            >
              <Check size={18} />
            </button>
          )}
          <button
            type="button"
            aria-label={`Dismiss ${item.merchant}`}
            className="w-11 h-11 grid place-items-center rounded-full"
            onClick={() => change("dismissed", "Dismissed")}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

export function SubscriptionsClient() {
  const [tab, setTab] = useState<"" | "dismissed">("");
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useSubscriptions(tab);
  const items = data?.subscriptions ?? [];
  const totals = data?.totals;

  return (
    <div className="page-stack">
      <PageHeader
        title="Subscriptions"
        subtitle={
          tab === "" && totals && totals.count > 0
            ? `${totals.count} repeating · ${formatCurrency(totals.yearly)} a year`
            : "Charges that repeat on a schedule"
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "" | "dismissed")}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="inset-group">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] rounded-none" />)}
        </div>
      ) : items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-(--r-lg) py-16 text-center px-6"
          style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}
        >
          <Repeat size={28} style={{ color: "var(--ink-3)" }} />
          <p style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
            {tab === "dismissed" ? "Nothing dismissed" : "No repeating charges found yet"}
          </p>
          {tab === "" && (
            <p style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
              A charge shows up here once it has repeated at least three times.
            </p>
          )}
        </div>
      ) : (
        <div className="inset-group" style={{ "--inset": "74px" } as CSSProperties}>
          {items.map((s) => <SubscriptionRow key={s.id} item={s} />)}
        </div>
      )}
    </div>
  );
}
