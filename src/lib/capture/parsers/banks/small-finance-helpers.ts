// Readers shared by the small finance and payments bank parsers (ticket 173). Written for this codebase from
// invented examples. Every pattern is bounded; the text has its whitespace collapsed by KnownBankParser first.

import { cleanParty } from "./known";

/** "UPI/DR/604411223344/SOME SHOP/HDFC/..." or "UPI/CR/C604411223344/A NAME/u": the reference (digits only, a leading
 * D or C dropped) and the other party. The name ends at the next "/", at " Value <date>", " on", a balance label or a
 * sentence end. */
const UPI_PATH = /\bUPI\/(DR|CR)\/[A-Z]?(\d{6,22})\/([^/.;]{1,40}?)(?=\/|\sValue\b|\s(?:on|Bal|Avl|Clear)\b|\.(?:\s|$)|$)/i;

export function upiPath(text: string): { direction: "DR" | "CR"; ref: string; party?: string } | undefined {
  const m = text.match(UPI_PATH);
  if (!m) return undefined;
  return { direction: m[1].toUpperCase() as "DR" | "CR", ref: m[2], party: cleanParty(m[3]) };
}

/** A UPI id with the label a bank glues after it dropped ("swiggy@ybl.Avl Bal" gives "swiggy@ybl"). */
export function cleanVpa(vpa: string | undefined): string | undefined {
  return vpa?.replace(/\.(?:Avl|Avbl|Bal|Ref|UPI|Not|Info|Txn)\b.{0,80}$/i, "") || undefined;
}

/** A payee that is really an account or a number: a single-x or longer mask ("x8820", "XX4471"), digits only, a
 * bank's own account written "Equitas-4419", or a masked phone number ("70xxxxx991"). */
export function maskOrNumber(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  return (
    /^[x*]{1,12}\d{3,}$/i.test(v) ||
    /(?:^|\s)[x*]{1,12}\d{3,}\b/i.test(v) ||
    /^\+?[\d\s-]{4,}$/.test(v) ||
    /\d{2,}[x*]{2,}\d*/i.test(v) ||
    /^[A-Za-z]{2,12}-\d{3,}$/.test(v) ||
    /\b(?:a\/c|acct|account)\b/i.test(v)
  );
}
