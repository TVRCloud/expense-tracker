"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Check, ChevronRight, Inbox as InboxIcon, PencilLine, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/_ui/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { Switch } from "@/components/_ui/Switch";
import { Skeleton } from "@/components/_ui/Skeleton";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { useCurrency } from "@/hooks/useCurrency";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { CATEGORIES } from "@/features/transactions/components/AddTransactionForm";
import {
  QUEUE_REASON_LABEL,
  REASON_LABEL,
  useConfirmTransaction,
  useCorrectionHistory,
  useDiscardCapture,
  useReconcileInbox,
  useResolveCapture,
  type InboxCapture,
  type InboxTxn,
} from "@/features/reconcile/hooks/useReconcile";
import { SourceBadge } from "./SourceBadge";
import { CorrectionSheet } from "./CorrectionSheet";

// /reconcile: everything auto-captured that needs a human look.
//  - Needs review: transactions created from SMS / n8n / notifications that
//    nobody has confirmed yet. Notification-sourced ones first.
//  - Couldn't match: messages that didn't become a transaction on their own.
//  - History: every correction ever made.

function Amount({ type, amount }: { type: string | null; amount: number | null }) {
  const { formatCurrency } = useCurrency();
  if (amount == null) return <span style={{ color: "var(--ink-3)" }}>—</span>;
  const income = type === "income";
  return (
    <span className="tnum font-bold whitespace-nowrap" style={{ color: income ? "var(--green)" : "var(--red)" }}>
      <span className="sr-only">{income ? "Credit" : "Debit"} </span>
      {income ? "+" : "−"}{formatCurrency(amount)}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card radius="lg" className="p-10 flex flex-col items-center gap-2 text-center">
      <InboxIcon size={22} style={{ color: "var(--ink-3)" }} aria-hidden />
      <p className="text-sm" style={{ color: "var(--ink-3)" }}>{text}</p>
    </Card>
  );
}

function NeedsReviewRow({ txn }: { txn: InboxTxn }) {
  const confirmTxn = useConfirmTransaction();
  const [fixing, setFixing] = useState(false);
  const fallback = txn.sourceInfo.priority === "fallback";

  return (
    <Card radius="lg" className="p-5 flex flex-col gap-3.5 min-w-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[15px] truncate" style={{ color: "var(--ink)" }}>{txn.description || txn.category}</span>
            <SourceBadge source={txn.source} />
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>
            {format(new Date(txn.date), "d MMM yyyy, HH:mm")} · {txn.accountName ?? "Account"} · {txn.category}
          </div>
          {fallback && (
            <div className="text-xs font-bold mt-1" style={{ color: "var(--amber)" }}>
              From an app notification. No SMS yet, so check the values.
            </div>
          )}
        </div>
        <Amount type={txn.type} amount={txn.amount} />
      </div>
      {txn.sourceCapture?.text && (
        <blockquote className="rounded-(--r-sm) px-3 py-2 text-xs leading-relaxed break-words" style={{ background: "var(--card-2)", color: "var(--ink-2)" }}>
          {txn.sourceCapture.text}
        </blockquote>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => confirmTxn.mutate(txn.id)} disabled={confirmTxn.isPending} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
          <Check size={15} />
          Looks right
        </Button>
        <Button type="button" variant="secondary" onClick={() => setFixing(true)} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
          <PencilLine size={15} />
          Fix this…
        </Button>
        <Link href={`/transactions/${txn.id}`} className="inline-flex items-center gap-1 text-sm font-bold ml-auto px-2 min-h-9" style={{ color: "var(--violet)" }}>
          Details <ChevronRight size={15} />
        </Link>
      </div>
      <CorrectionSheet open={fixing} onOpenChange={setFixing} transaction={txn} sourceInfo={txn.sourceInfo} rawText={txn.sourceCapture?.text} />
    </Card>
  );
}

function CreateFromCapture({ capture, onDone }: { capture: InboxCapture; onDone: () => void }) {
  const { data: accounts } = useAccounts();
  const resolve = useResolveCapture();
  const [form, setForm] = useState({
    accountId: "",
    type: capture.parsed.type ?? "expense",
    amount: capture.parsed.amount != null ? (capture.parsed.amount / 100).toFixed(2) : "",
    category: "other",
    description: capture.parsed.merchant ?? "",
    rememberDigits: Boolean(capture.parsed.last4),
  });
  const amountMinor = Math.round(Number.parseFloat(form.amount || "0") * 100);
  const valid = form.accountId && amountMinor > 0;
  const label = (t: string) => (
    <Label className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>{t}</Label>
  );

  return (
    <div className="rounded-(--r-md) p-3.5 flex flex-col gap-3" style={{ background: "var(--card-2)" }}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          {label("Amount (₹)")}
          <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          {label("Type")}
          <Select value={form.type} onValueChange={(type) => setForm((f) => ({ ...f, type: type as "income" | "expense" }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Debit</SelectItem>
              <SelectItem value="income">Credit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          {label("Account")}
          <Select value={form.accountId} onValueChange={(accountId) => setForm((f) => ({ ...f, accountId }))}>
            <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>
              {(accounts ?? []).filter((a) => !a.isArchived).map((a) => (
                <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          {label("Category")}
          <Select value={form.category} onValueChange={(category) => setForm((f) => ({ ...f, category }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.filter((c) => c.value !== "transfer").map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {label("Merchant / description")}
        <Input value={form.description} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </div>
      {capture.parsed.last4 && (
        <label className="flex items-center justify-between gap-3 text-sm" style={{ color: "var(--ink-2)" }}>
          <span>Match digits …{capture.parsed.last4} to this account next time</span>
          <Switch checked={form.rememberDigits} onCheckedChange={(rememberDigits) => setForm((f) => ({ ...f, rememberDigits }))} />
        </label>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={!valid || resolve.isPending}
          onClick={() =>
            resolve.mutate(
              {
                id: capture.id,
                input: {
                  action: "create",
                  accountId: form.accountId,
                  type: form.type as "income" | "expense",
                  amount: amountMinor,
                  category: form.category,
                  description: form.description || undefined,
                  date: capture.parsed.date ? new Date(capture.parsed.date).toISOString() : undefined,
                  rememberDigits: form.rememberDigits,
                },
              },
              { onSuccess: onDone }
            )
          }
          className="h-auto px-4 py-2 rounded-full font-semibold text-sm"
        >
          {resolve.isPending ? "Adding..." : "Add transaction"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CouldntMatchRow({ capture }: { capture: InboxCapture }) {
  const { formatCurrency } = useCurrency();
  const resolve = useResolveCapture();
  const discard = useDiscardCapture();
  const { confirm, dialog } = useConfirm();
  const [creating, setCreating] = useState(false);
  const related = capture.relatedTransaction;

  const onDiscard = async () => {
    const ok = await confirm({
      title: "Discard this message?",
      description: "Nothing is added to your history. The message stays on record as discarded.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (ok) discard.mutate(capture.id);
  };

  return (
    <Card radius="lg" className="p-5 flex flex-col gap-3.5 min-w-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm" style={{ color: "var(--ink)" }}>
              {QUEUE_REASON_LABEL[capture.reason ?? ""] ?? "Needs a look"}
            </span>
            <SourceBadge source={capture.channel} />
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--ink-3)" }}>
            {capture.sender ?? capture.source.label} · {format(new Date(capture.receivedAt), "d MMM yyyy, HH:mm")}
          </div>
        </div>
        <Amount type={capture.parsed.type} amount={capture.parsed.amount} />
      </div>

      <blockquote className="rounded-(--r-sm) px-3 py-2 text-xs leading-relaxed break-words" style={{ background: "var(--card-2)", color: "var(--ink-2)" }}>
        {capture.text ?? "Message text unavailable."}
      </blockquote>

      {related && (
        <div className="rounded-(--r-sm) px-3 py-2 text-xs flex items-center justify-between gap-3" style={{ border: "1px solid var(--line)" }}>
          <span style={{ color: "var(--ink-2)" }}>
            {capture.reason === "source_conflict" ? "You confirmed" : "Existing"}: {related.description || related.category} ·{" "}
            {format(new Date(related.date), "d MMM, HH:mm")} · {related.accountName ?? "Account"}
          </span>
          <span className="font-bold tnum">{formatCurrency(related.amount)}</span>
        </div>
      )}

      {creating ? (
        <CreateFromCapture capture={capture} onDone={() => setCreating(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {capture.reason === "source_conflict" ? (
            <>
              <Button type="button" variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: capture.id, input: { action: "keep_mine" } })} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
                Keep mine
              </Button>
              <Button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: capture.id, input: { action: "use_sms" } })} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
                Use SMS values
              </Button>
            </>
          ) : capture.reason === "possible_duplicate" && related ? (
            <>
              <Button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: capture.id, input: { action: "link" } })} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
                Same payment
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(true)} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
                It&apos;s separate
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setCreating(true)} className="h-auto px-4 py-2 rounded-full font-semibold text-sm">
              <Plus size={15} />
              Add as transaction
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => void onDiscard()} disabled={discard.isPending} className="h-auto px-3.5 py-2 rounded-full font-semibold text-sm ml-auto" style={{ color: "var(--red)" }}>
            <Trash2 size={15} />
            Discard
          </Button>
        </div>
      )}
      {dialog}
    </Card>
  );
}

function HistoryList() {
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useCorrectionHistory();
  if (isLoading) return <Skeleton className="h-40 rounded-(--r-lg)" />;
  if (!data?.length) return <EmptyState text="No corrections yet. Fixes you make, and SMS updates, show here." />;
  return (
    <div className="inset-group" style={{ "--inset": "16px" } as React.CSSProperties}>
      {data.map((c) => (
        <Link key={c.id} href={`/transactions/${c.transactionId}`} className="flex items-center gap-3 px-4 py-3.5 min-h-14 transition-colors hover:bg-(--card-2) active:bg-(--card-2)">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>{c.transactionLabel}</div>
            <div className="text-xs" style={{ color: "var(--ink-3)" }}>
              {REASON_LABEL[c.reason] ?? c.reason} · {c.via === "system" ? "automatic" : c.via} · {format(new Date(c.createdAt), "d MMM yyyy, HH:mm")}
            </div>
          </div>
          <div className="text-xs text-right tnum" style={{ color: "var(--ink-2)" }}>
            {c.after === null ? (
              <>Removed {formatCurrency(c.before.amount)}</>
            ) : c.changedFields.includes("amount") ? (
              <>
                <s style={{ color: "var(--ink-3)" }}>{formatCurrency(c.before.amount)}</s> → {formatCurrency(c.after.amount)}
              </>
            ) : (
              c.changedFields.join(", ") || "No value change"
            )}
          </div>
          <ChevronRight size={16} style={{ color: "var(--ink-3)" }} />
        </Link>
      ))}
    </div>
  );
}

export function ReconcileClient() {
  const { data, isLoading } = useReconcileInbox();
  const [tab, setTab] = useState("review");

  const waiting = data?.counts.waitingForSms ?? 0;
  const stat = (label: string, value: number | undefined, tone?: string) => (
    <Card radius="lg" className="p-5 flex flex-col gap-2 min-w-0">
      <span style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>{label}</span>
      <span className="tnum" style={{ font: "var(--text-stat)", color: tone ?? "var(--ink)" }}>{value ?? "–"}</span>
    </Card>
  );
  const list = "grid-cards";
  const listVars = { "--card-min": "min(100%, 400px)" } as React.CSSProperties;

  return (
    <div className="page-stack pb-8">
      <PageHeader
        title="Reconcile"
        subtitle={
          <>
            Payments captured from SMS, n8n and app notifications. SMS is the source of truth; notifications are used only when no SMS arrives.
            {waiting ? ` ${waiting} notification${waiting === 1 ? " is" : "s are"} waiting for an SMS.` : ""}
          </>
        }
      />

      <div className="grid-cards" style={{ "--card-min": "180px" } as React.CSSProperties}>
        {stat("Needs review", data?.counts.needsReview, data?.counts.needsReview ? "var(--amber)" : undefined)}
        {stat("Couldn't match", data?.counts.couldntMatch)}
        {stat("Waiting for SMS", data ? waiting : undefined)}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-full p-0.5 h-auto" style={{ background: "var(--card-2)" }}>
          <TabsTrigger value="review" className="rounded-full px-4 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-11">Needs review{data ? ` (${data.counts.needsReview})` : ""}</TabsTrigger>
          <TabsTrigger value="unmatched" className="rounded-full px-4 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-11">Couldn&apos;t match{data ? ` (${data.counts.couldntMatch})` : ""}</TabsTrigger>
          <TabsTrigger value="history" className="rounded-full px-4 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-11">History</TabsTrigger>
        </TabsList>

        <TabsContent value="review" className="mt-5">
          {isLoading ? (
            <Skeleton className="h-40 rounded-(--r-lg)" />
          ) : data?.needsReview.length ? (
            <div className={list} style={listVars}>{data.needsReview.map((t) => <NeedsReviewRow key={t.id} txn={t} />)}</div>
          ) : (
            <EmptyState text="All caught up. New captured payments land here for a quick check." />
          )}
        </TabsContent>

        <TabsContent value="unmatched" className="mt-5">
          {isLoading ? (
            <Skeleton className="h-40 rounded-(--r-lg)" />
          ) : data?.couldntMatch.length ? (
            <div className={list} style={listVars}>{data.couldntMatch.map((c) => <CouldntMatchRow key={c.id} capture={c} />)}</div>
          ) : (
            <EmptyState text="Nothing waiting. Messages that can't be matched to an account show here." />
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          {tab === "history" && <HistoryList />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
