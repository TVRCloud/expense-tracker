// Readers shared by the small finance and payments bank parsers (ticket 173). Written for this codebase from
// invented examples. Every pattern is bounded; the text has its whitespace collapsed by KnownBankParser first.

import type { FoundAccount } from "../extract/account";
import { cleanParty } from "./known";

/** "UPI/DR/604411223344/SOME SHOP/HDFC/..." or "UPI/CR/C604411223344/A NAME/u": the reference and the other party.
 * The name ends at the next "/", at " Value <date>", " on", a balance label or a sentence end. */
const UPI_PATH = /\bUPI\/(DR|CR)\/([A-Z]?\d{6,22})\/([^/.;]{1,40}?)(?=\/|\sValue\b|\s(?:on|Bal|Avl|Clear)\b|\.(?:\s|$)|$)/i;

export function upiPath(text: string): { direction: "DR" | "CR"; ref: string; party?: string } | undefined {
  const m = text.match(UPI_PATH);
  if (!m) return undefined;
  return { direction: m[1].toUpperCase() as "DR" | "CR", ref: m[2], party: cleanParty(m[3]) };
}

/** The person's own account written with its digits after a bank word, not masked: "Equitas A/c 7302",
 * "Equitas-7302". `bank` is a fixed literal from the parser, never message text. */
export function plainAccount(text: string, bank: string): FoundAccount | null {
  const m = text.match(new RegExp(String.raw`\b${bank}(?:\sA\/c\s|-)(\d{4})\b`, "i"));
  return m ? { last4: m[1], instrument: "account" } : null;
}
