// What the public sector bank parsers (ticket 171) share on top of KnownBankParser: two reads that stay in Review
// whatever shape matched, and a name cleaner for the payee fields these banks print.

import type { MoneyParse } from "../types";
import { cleanParty, KnownBankParser, moneySentence, REVIEW_CEILING } from "./known";

/** A debit that was taken back: the verb, never a payee's name ("REFUND CORNER") or a help line ("Cash not dispensed?
 * Call …", "For refunds call …"). */
const DEBIT_UNDONE = /\b(?:reversed|refunded|reversal\scredit|not\sdispensed(?!\s?\?))\b/i;
/** Money into a loan or towards an EMI as what was credited: a repayment, never income of the person's own account.
 * Read only in the money sentence (and a follow-up sentence about the same amount), with payer fields taken out, so a
 * promo line ("Apply for a Home Loan") or a payer's name ("EMI STORE", "FOR LOAN HELP NGO") never counts. */
const INTO_LOAN =
  /\b(?:(?:credited|cr)\b[^.]{0,40}?\b(?:to|in)\s(?:your\s)?(?:home\s|personal\s|car\s)?(?:loan|EMI)\b|towards\s(?:your\s)?(?:loan|EMI)\b|repayment\sof\s(?:your\s)?loan\b|loan\s(?:a\/c|acct|account)\b[^.]{0,60}?\bcredited\b|--(?:EMI|LOAN\s(?:RECOVERY|REPAYMENT))\b|\b(?:for|as|against)\s(?:your\s)?(?:home\s|personal\s|car\s)?(?:loan|EMI)\b|\b(?:loan|EMI)\s(?:recovery|instal(?:l)?ments?|dues)\b)/i;
/** Who paid ("from LATA IYER", "by MB 6601234678 NAME", "By.NAME", "by NEFT from NAME"): left out before INTO_LOAN. */
// It stops before "towards", so "by MB … EMI HUB towards EMI" still says what the money was for.
const PAYER_FIELD = /\b(?:from|by\sMB\s\d{6,12}|By\.|by\s(?:NEFT|IMPS|RTGS|UPI)\sfrom)\s?[^,;.(]{0,60}?(?=\stowards\s|[,;.(]|$)/gi;
/** A sentence right after the money sentence that is about the same amount ("This amount is towards loan instalment",
 * "Being repayment of Loan", "Adjusted against your home loan dues"), never a promo. */
const SAME_AMOUNT = /^(?:This\samount|The\samount|Amount|Being|Adjusted|Towards)\b/i;
/** The person's own account the repayment left, when the money sentence names it with an account word ("for EMI from
 * A/c *5093", "by debit to SB XXXX3917"); never a loan's, never bare digits. */
const PAID_FROM =
  /(?<!\bloan\s)\b(?:from|by\sdebit\sto|debited\sfrom)\s(?:your\s)?(?:SB\s(?:a\/c\s|acct\s|account\s)?|(?:a\/c|acct|account)\s?(?:no\.?\s?)?)[x*]{0,12}(\d{4})\b/i;

/** The money sentence, plus the next sentence when it is about the same amount. */
function amountScope(flat: string): string {
  const money = moneySentence(flat);
  const at = flat.indexOf(money);
  if (at < 0) return money;
  const next = flat.slice(at + money.length).replace(/^[.\s]+/, "").split(/\.\s?(?=[A-Z])/)[0] ?? "";
  return SAME_AMOUNT.test(next) ? `${money}. ${next}` : money;
}

export abstract class PublicSectorParser extends KnownBankParser {
  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (!parse) return null;
    const flat = text.replace(/\s+/g, " ");
    const undone = parse.type === "expense" && DEBIT_UNDONE.test(flat);
    const scope = amountScope(flat);
    const intoLoan = parse.type === "income" && INTO_LOAN.test(scope.replace(PAYER_FIELD, " "));
    if (!undone && !intoLoan) return parse;
    const capped = { ...parse, confidence: Math.min(parse.confidence, REVIEW_CEILING) };
    if (!intoLoan) return capped;
    // The account credited "towards Loan EMI" is most likely the loan itself: its digits, balance and a "Loan EMI"
    // merchant are dropped, so a confirm in Review can never teach a savings account the loan's number.
    const { last4: _last4, instrument: _instrument, balanceMinor: _balance, ...rest } = capped;
    const merchant = parse.merchant && /^(?:loan|EMI)\b/i.test(parse.merchant) ? undefined : parse.merchant;
    // A repayment that names the account it left ("for EMI from A/c *5093") is that account's expense, still in Review.
    const from = scope.match(PAID_FROM);
    if (from) return { ...rest, merchant, type: "expense", last4: from[1], instrument: "account" };
    return { ...rest, merchant };
  }
}

/** A reason a bank prints where a name would be ("towards refund of …", "reversal of UPI txn", a bare "REV", "Personal
 * Loan disbursal"). Real names
 * that start with these words ("REV MOTORS", "Towards Travels", "REFUND DESK OF KART") are kept. */
const REASON =
  /^(?:towards\s(?:refund|reversal|loan|EMI|your)\b|reversal\sof\b|refund\s(?:of|for|from)\b|(?:rev|reversal|refund|transfer|cash|clearing)$|(?:\w+\s){0,2}loan\sdisburs(?:al|ement)$)/i;

/** A payee as these banks print it, minus a "Sender:"/"Beneficiary:" label and any run of eight or more digits (a phone
 * or account number): "RAVI 9812345678" is "RAVI". A UPI id made of a phone number names a person by number only, so
 * it gives no merchant. */
export function nameOnly(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw
    .slice(0, 80)
    .replace(/^(?:Sender|Beneficiary|Remitter)\s?:\s?/i, "")
    .replace(/\s?\+?\d{8,}(?=\b|@)/g, "")
    // "SHOPKART refund": the name, without the reason after it.
    .replace(/\s(?:refund|reversal)$/i, "")
    .trim();
  if (/^@/.test(v) || REASON.test(v)) return undefined;
  return cleanParty(v);
}
