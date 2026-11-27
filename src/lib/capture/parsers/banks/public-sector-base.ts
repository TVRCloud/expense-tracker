// What the public sector bank parsers (ticket 171) share on top of KnownBankParser: two reads that stay in Review
// whatever shape matched, and a name cleaner for the payee fields these banks print.

import type { MoneyParse } from "../types";
import { cleanParty, KnownBankParser, REVIEW_CEILING } from "./known";

/** A debit that was taken back ("… reversed", "cash not dispensed"): not settled spending. */
const DEBIT_UNDONE = /\b(?:revers(?:al|ed)|not\sdispensed|refund(?:ed)?)\b/i;
/** Money into a loan or towards an EMI: a repayment, never income of the person's own account. */
const INTO_LOAN = /\b(?:loan|EMI)\b/i;

export abstract class PublicSectorParser extends KnownBankParser {
  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (!parse) return null;
    const flat = text.replace(/\s+/g, " ");
    const undone = parse.type === "expense" && DEBIT_UNDONE.test(flat);
    const intoLoan = parse.type === "income" && INTO_LOAN.test(flat);
    if (!undone && !intoLoan) return parse;
    const capped = { ...parse, confidence: Math.min(parse.confidence, REVIEW_CEILING) };
    if (!intoLoan) return capped;
    // The account credited "towards Loan EMI" is most likely the loan itself: its digits, balance and a "Loan EMI"
    // merchant are dropped, so a confirm in Review can never teach a savings account the loan's number.
    const { last4: _last4, instrument: _instrument, balanceMinor: _balance, ...rest } = capped;
    return { ...rest, merchant: parse.merchant && INTO_LOAN.test(parse.merchant) ? undefined : parse.merchant };
  }
}

/** A payee as these banks print it, minus a "Sender"/"Beneficiary" label, a "towards …" reason and any run of six or more
 * digits (a phone or account number): "Beneficiary MEHTA STEELS" is "MEHTA STEELS", "RAVI 9812345678" is "RAVI". */
export function nameOnly(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw
    .slice(0, 80)
    .replace(/^(?:Sender|Beneficiary|Remitter)\s/i, "")
    .replace(/\s?\+?\d{6,}\b/g, "")
    .trim();
  if (/^(?:towards|reversal|refund|rev|REV)\b/i.test(v)) return undefined;
  return cleanParty(v);
}
