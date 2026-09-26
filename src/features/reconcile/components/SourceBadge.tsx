import { BellRing, CircleAlert, CircleCheck, MessageSquareText, PencilLine, Workflow } from "lucide-react";
import type { SourceInfo } from "@/features/reconcile/hooks/useReconcile";

// Small, consistent markers for where a transaction's values came from and
// whether they've been reviewed. Always icon + text, never colour alone.

const SOURCE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  sms: { label: "SMS", icon: MessageSquareText, color: "var(--violet)" },
  n8n: { label: "n8n", icon: Workflow, color: "var(--violet)" },
  notification: { label: "Notification", icon: BellRing, color: "var(--amber)" },
};

function Pill({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-none"
      style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      <Icon size={10} aria-hidden />
      {label}
    </span>
  );
}

export function SourceBadge({ source }: { source?: string | null }) {
  const meta = source ? SOURCE_META[source] : undefined;
  if (!meta) return null;
  return <Pill icon={meta.icon} label={meta.label} color={meta.color} />;
}

export function ReviewBadge({ status }: { status?: string | null }) {
  if (status === "unreviewed") return <Pill icon={CircleAlert} label="Needs review" color="var(--amber)" />;
  if (status === "corrected") return <Pill icon={PencilLine} label="Corrected" color="var(--violet)" />;
  if (status === "confirmed") return <Pill icon={CircleCheck} label="Reviewed" color="var(--green)" />;
  return null;
}

/** The banner that says which source a transaction's values come from. */
export function SourceBanner({ info }: { info: SourceInfo }) {
  const fallback = info.priority === "fallback";
  const Icon = fallback ? BellRing : info.priority === "manual" ? PencilLine : MessageSquareText;
  const color = fallback ? "var(--amber)" : "var(--violet)";
  return (
    <div
      className="flex items-start gap-2.5 rounded-(--r-md) px-3.5 py-3"
      style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}
      role="status"
    >
      <Icon size={16} className="flex-none mt-0.5" style={{ color }} aria-hidden />
      <div className="text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
        <span className="font-bold" style={{ color: "var(--ink)" }}>Values from: {info.label}</span>
        {fallback && (
          <span className="block">
            No SMS for this payment has arrived yet. App notifications are less reliable than SMS, so check the amount and account.
          </span>
        )}
        {info.priority === "secondary" && (
          <span className="block">Forwarded SMS text. If the phone captures the SMS itself, that becomes the source of truth.</span>
        )}
      </div>
    </div>
  );
}
