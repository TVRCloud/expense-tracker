"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Check, ChevronDown, Eye, EyeOff, PencilLine } from "lucide-react";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { useCurrency } from "@/hooks/useCurrency";
import {
  REASON_LABEL,
  useConfirmTransaction,
  useProvenance,
  type CaptureView,
  type CorrectionView,
  type TxnView,
} from "@/features/reconcile/hooks/useReconcile";
import { SourceBanner } from "./SourceBadge";
import { CorrectionSheet } from "./CorrectionSheet";

// "Where did these numbers come from?" on the transaction detail page: the
// source of truth, every other capture of the same payment with any value
// that disagrees, the review actions, and the correction timeline.

function differences(capture: CaptureView, txn: TxnView) {
  const diffs: string[] = [];
  if (capture.parsed.amount != null && capture.parsed.amount !== txn.amount) diffs.push("amount");
  if (capture.parsed.type && capture.parsed.type !== txn.type) diffs.push("type");
  return diffs;
}

function CaptureText({ capture, defaultOpen }: { capture: CaptureView; defaultOpen: boolean }) {
  const [shown, setShown] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-bold self-start min-h-8"
        style={{ color: "var(--violet)" }}
        aria-expanded={shown}
      >
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
        {shown ? "Hide message" : "Show message"}
      </button>
      {shown && (
        <blockquote
          className="rounded-(--r-sm) px-3 py-2 text-xs leading-relaxed break-words"
          style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
        >
          {capture.text ?? "Message text unavailable."}
        </blockquote>
      )}
    </div>
  );
}

function CorrectionRow({ c, formatCurrency }: { c: CorrectionView; formatCurrency: (n: number) => string }) {
  const show = (field: string, s: CorrectionView["before"] | null) => {
    if (!s) return "Removed";
    if (field === "amount") return formatCurrency(s.amount);
    if (field === "type") return s.type === "income" ? "Credit" : "Debit";
    if (field === "account") return s.accountName ?? "Account";
    if (field === "date") return format(new Date(s.date), "d MMM yyyy, HH:mm");
    if (field === "category") return s.category;
    if (field === "description") return s.description || "—";
    return "";
  };
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>{REASON_LABEL[c.reason] ?? c.reason}</span>
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>
          {format(new Date(c.createdAt), "d MMM, HH:mm")} · {c.via === "system" ? "automatic" : c.via}
        </span>
      </div>
      {c.after === null ? (
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>
          Removed. Was {formatCurrency(c.before.amount)} on {c.before.accountName ?? "an account"}.
        </span>
      ) : (
        c.changedFields.map((f) => (
          <span key={f} className="text-xs" style={{ color: "var(--ink-2)" }}>
            <span className="capitalize">{f}</span>: <s style={{ color: "var(--ink-3)" }}>{show(f, c.before)}</s> → <strong>{show(f, c.after)}</strong>
          </span>
        ))
      )}
      {c.note && <span className="text-xs italic" style={{ color: "var(--ink-3)" }}>“{c.note}”</span>}
    </li>
  );
}

export function ProvenanceCard({ transactionId }: { transactionId: string }) {
  const { formatCurrency } = useCurrency();
  const { data, isLoading } = useProvenance(transactionId);
  const confirmTxn = useConfirmTransaction();
  const [fixing, setFixing] = useState(false);
  const [showOthers, setShowOthers] = useState(false);

  if (isLoading || !data) return null;
  const { transaction: txn, captures, corrections, sourceCaptureId } = data;
  if (txn.source === "manual" && captures.length === 0 && corrections.length === 0) return null;

  const primary = captures.find((c) => c.id === sourceCaptureId) ?? captures[0];
  const others = captures.filter((c) => c.id !== primary?.id);
  const reviewable = txn.reviewStatus !== null && txn.reviewStatus !== "voided" && !txn.isDeleted && txn.type !== "transfer";

  return (
    <Card radius="lg" className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-extrabold" style={{ color: "var(--ink)" }}>Source of truth</h3>
        {txn.reviewStatus === "unreviewed" && (
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--amber)" }}>Needs review</span>
        )}
      </div>

      <SourceBanner info={txn.sourceInfo} />

      {primary && (
        <div className="text-xs" style={{ color: "var(--ink-3)" }}>
          {primary.sender ?? primary.packageName ?? primary.source.label} · received {format(new Date(primary.receivedAt), "d MMM yyyy, HH:mm")}
        </div>
      )}
      {primary && <CaptureText capture={primary} defaultOpen={txn.reviewStatus === "unreviewed"} />}

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-bold self-start min-h-8"
            style={{ color: "var(--ink-2)" }}
            aria-expanded={showOthers}
          >
            <ChevronDown size={15} style={{ transform: showOthers ? "rotate(180deg)" : undefined }} />
            Also seen in {others.length} other {others.length === 1 ? "message" : "messages"}
          </button>
          {showOthers &&
            others.map((c) => {
              const diffs = differences(c, txn);
              return (
                <div key={c.id} className="rounded-(--r-md) p-3 flex flex-col gap-1.5" style={{ background: "var(--card-2)" }}>
                  <div className="text-xs font-bold" style={{ color: "var(--ink)" }}>{c.source.label}</div>
                  {diffs.length > 0 ? (
                    <div className="text-xs font-bold" style={{ color: "var(--amber)" }}>
                      Different {diffs.join(" and ")}: said{" "}
                      {diffs.includes("amount") && c.parsed.amount != null ? formatCurrency(c.parsed.amount) : ""}
                      {diffs.includes("type") ? ` ${c.parsed.type === "income" ? "credit" : "debit"}` : ""}. The values above
                      come from the higher-priority source.
                    </div>
                  ) : (
                    <div className="text-xs" style={{ color: "var(--ink-3)" }}>Same values.</div>
                  )}
                  <CaptureText capture={c} defaultOpen={false} />
                </div>
              );
            })}
        </div>
      )}

      {reviewable && (
        <div className="flex flex-wrap gap-2">
          {txn.reviewStatus === "unreviewed" && (
            <Button
              type="button"
              onClick={() => confirmTxn.mutate(txn.id)}
              disabled={confirmTxn.isPending}
              className="h-auto px-4 py-2.5 rounded-(--r-sm) font-bold"
            >
              <Check size={16} />
              Looks right
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setFixing(true)} className="h-auto px-4 py-2.5 rounded-(--r-sm) font-bold">
            <PencilLine size={16} />
            Fix this…
          </Button>
        </div>
      )}

      {corrections.length > 0 && (
        <div>
          <h4 className="text-sm font-extrabold" style={{ color: "var(--ink)" }}>Correction history</h4>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {corrections.map((c) => <CorrectionRow key={c.id} c={c} formatCurrency={formatCurrency} />)}
          </ul>
        </div>
      )}

      <CorrectionSheet
        open={fixing}
        onOpenChange={setFixing}
        transaction={txn}
        sourceInfo={txn.sourceInfo}
        rawText={primary?.text}
      />
    </Card>
  );
}
