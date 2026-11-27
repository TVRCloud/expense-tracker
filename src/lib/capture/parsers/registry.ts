// Picks a bank parser from where a message came from. Order matters when two parsers could claim the same sender:
// the first that claims it wins. A new bank parser is added to BANK_PARSERS.

import type { BankParser, NormalisedSource } from "./base";
import type { MessageSource } from "./types";

/** Every bank parser, first match wins. Empty until the first bank parser lands (ticket 155). */
export const BANK_PARSERS: readonly BankParser[] = [];

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

export function normaliseSource(source: MessageSource | undefined): NormalisedSource {
  return {
    header: normaliseSender(source?.sender),
    packageName: source?.packageName?.trim().toLowerCase() || undefined,
  };
}

export function findBankParser(source: MessageSource | undefined, parsers: readonly BankParser[] = BANK_PARSERS): BankParser | null {
  if (!source?.sender && !source?.packageName) return null;
  const normalised = normaliseSource(source);
  return parsers.find((p) => p.canHandle(normalised)) ?? null;
}
