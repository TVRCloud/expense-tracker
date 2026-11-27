// What every bank parser shares: the bonus it earns only for its own message shapes, and small readers for the
// parties banks write in their own way. Written for this codebase from invented examples (ticket 155).

import { BankParser } from "../base";

/** Added when a message has one of the bank's known shapes (see `KnownBankParser.shapes`). */
export const SHAPE_BONUS = 0.05;

export abstract class KnownBankParser extends BankParser {
  /** Whole-message shapes this bank sends. Only a match earns the bonus, never the sender alone. */
  protected abstract readonly shapes: readonly RegExp[];

  protected override confidenceBonusFor(text: string): number {
    return this.shapes.some((re) => re.test(text)) ? SHAPE_BONUS : 0;
  }
}

/** Words that start a help line, never a party ("To dispute call 1800...", "To receive your refund"). */
const NOT_A_PARTY = /^(?:dispute|call|report|block|receive|clearing|reissue|mobile|an\s+a\/c|the\s+beneficiary)(?=[\s.,;:]|$)|^merchant$/i;

/** Trims dots, stars and dashes a bank pads a name with, and a trailing terminal number ("AMAZON   000"). */
export function cleanParty(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:at\s+)?[.*:\-\s]+|^at\s+/i, "")
    .replace(/[\s.*\-]+$/, "")
    .replace(/\s+\d{2,}$/, "")
    .trim();
  if (v.length < 2 || !/[A-Za-z]/.test(v) || NOT_A_PARTY.test(v)) return undefined;
  return v.slice(0, 60);
}

/** "debited by Rs 180.00 on 10-11-26; CORNER CAFE credited." : the payee named before "credited". */
export function creditedParty(text: string): string | undefined {
  const m = text.match(/;\s*([^;.]{2,60}?)\s+credited\b/i);
  return cleanParty(m?.[1]);
}

// Payment rails and codes a bank writes before the name ("ACH*", "NEFT-", "BIL*").
const RAIL = /^(?:N?ACH|ECS|BIL|INF|UPI|IMPS|NEFT|RTGS|MMT|POS|CMS|BBPS|SI)$/i;

/** "ACH*SOME POWER LTD*412", "NEFT-ABCD0123456789-ASHA RAO", "BIL*Car Loan": the first part that is a name. */
export function railParty(info: string | undefined): string | undefined {
  if (!info) return undefined;
  const parts = info
    .split(/[*/]/)
    // "NEFT-<ref>-<name>" splits on its dashes; a name with a dash ("BD-ACHKFL") stays whole.
    .flatMap((p) => (/^\s*(?:NEFT|IMPS|RTGS|UPI)-/i.test(p) ? p.split("-") : [p]))
    .map((p) => p.trim())
    .filter((p) => p && !RAIL.test(p) && !/\d{3,}/.test(p) && /[A-Za-z]{2}/.test(p));
  return cleanParty(parts[0]);
}

/** A UPI id the money went to or came from, digits and all ("to 98xxxxxx01@paytm"). */
export function vpaAfter(word: "to" | "from", text: string): string | undefined {
  const m = text.match(new RegExp(String.raw`\b${word}\s+(?:VPA\s+)?([\w.\-]+@[A-Za-z][\w.\-]*?)(?=[\s,;)]|\.(?:\s|$)|$)`, "i"));
  return m?.[1];
}

/** The shared merchant guess, minus help-line text it sometimes picks up. */
export function sharedParty(value: string | undefined): string | undefined {
  return value && !NOT_A_PARTY.test(value.trim()) ? value : undefined;
}
