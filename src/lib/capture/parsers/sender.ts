// Sender ids as the registry compares them.

import type { NormalisedSource } from "./base";
import type { MessageSource } from "./types";

/**
 * "VM-HDFCBK", "AX-HDFCBK-S", "hdfcbk" -> "HDFCBK". Indian SMS headers are a two-letter operator and circle prefix,
 * the six-letter entity header, and since 2025 an optional type suffix (-S service, -T transactional, -P promotional,
 * -G government). A phone number or an app label comes back upper cased, which matches no bank header.
 */
export function normaliseSender(sender: string | null | undefined): string | undefined {
  const s = sender?.trim().toUpperCase();
  if (!s) return undefined;
  return s.replace(/^[A-Z]{2}-(?=[A-Z0-9]{3,})/, "").replace(/-[SPTG]$/, "");
}

/**
 * A notification is matched by its app package only: its "sender" is the app's own label, which any app can set, so
 * a label like "AB-HDFCBK" never routes to a bank. An SMS (no package) is matched by its header.
 */
export function normaliseSource(source: MessageSource | undefined): NormalisedSource {
  const packageName = source?.packageName?.trim().toLowerCase() || undefined;
  return packageName ? { packageName } : { header: normaliseSender(source?.sender) };
}
