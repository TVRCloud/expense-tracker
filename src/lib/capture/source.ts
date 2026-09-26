import { createHash } from "crypto";

export type CaptureChannel = "sms" | "notification" | "n8n";
export type TransactionSource = "manual" | "sms" | "notification" | "n8n" | "recurring" | "import";

// Source of truth, highest first. The phone's own SMS receiver is primary.
// n8n forwards SMS text too, so it ranks just below. A bank-app notification
// is only a fallback: it never overrides an SMS, and a transaction created
// from one is labelled "lower priority, please verify" until an SMS arrives
// or the user confirms it.
export const SOURCE_PRIORITY: Record<CaptureChannel, number> = {
  sms: 3,
  n8n: 2,
  notification: 1,
};

export function sourcePriorityOf(source: string | null | undefined): number {
  return SOURCE_PRIORITY[source as CaptureChannel] ?? 0;
}

// How long a notification waits for its matching SMS before it becomes a
// transaction on its own.
export const NOTIFICATION_HOLD_MS = 15 * 60 * 1000;

// Two captures on different channels count as the same payment when their
// times are this close (or on the same IST day when either has no time).
export const MATCH_WINDOW_MS = 10 * 60 * 1000;

/**
 * Normalized form used for the content hash, so the same SMS forwarded by
 * n8n and captured on the phone hashes identically even if one of them added
 * a sender prefix ("VM-HDFCBK: ..."), trailing spaces or different line
 * breaks.
 */
export function normalizeForHash(text: string): string {
  return text
    .replace(/^[A-Z]{2}-[A-Z0-9]{3,9}(-[A-Z])?\s*[:>-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function contentHashOf(text: string): string {
  return createHash("sha256").update(normalizeForHash(text)).digest("hex");
}
