// Picks a bank parser from where a message came from. Order matters when two parsers could claim the same sender:
// the first that claims it wins. A new bank parser is added to BANK_PARSERS.

import type { BankParser } from "./base";
import { BANKS } from "./banks";
import { normaliseSource } from "./sender";
import type { MessageSource } from "./types";

export { normaliseSender, normaliseSource } from "./sender";

/** Every bank parser, first match wins (banks/index.ts). */
export const BANK_PARSERS: readonly BankParser[] = BANKS;

export function findBankParser(source: MessageSource | undefined, parsers: readonly BankParser[] = BANK_PARSERS): BankParser | null {
  if (!source?.sender && !source?.packageName) return null;
  const normalised = normaliseSource(source);
  return parsers.find((p) => p.canHandle(normalised)) ?? null;
}
