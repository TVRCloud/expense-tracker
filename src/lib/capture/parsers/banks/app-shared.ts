// What the payment app, wallet and card app parsers share (ticket 175). Apps rarely print the person's account: a
// wallet or a pay-later line has no account number, and an app's copy of a UPI payment would only repeat the bank's
// own message. So these parsers never invent digits, and a figure such as a wallet balance with no account to belong
// to is dropped rather than kept on a parse a later step might attach to a guessed account.

import { KnownBankParser, REVIEW_CEILING } from "./known";
import type { MoneyParse } from "../types";

/** An amount as printed: "Rs.1,265.30", "₹ 97", "INR 43". */
export const AMT = String.raw`(?:Rs\.?|INR|₹)\s?\d[\d,]{0,11}(?:\.\d{1,2})?`;
/** "You've", with a straight or a curly apostrophe, or none. */
export const YOUVE = String.raw`You['’]?ve`;

/** A party name as an app prints it, minus what never belongs to it: a trailing " on <date> (at <time>)", a phone or
 * account number (a run of seven or more digits) and a UPI id made only of digits (a phone number). */
export function cleanAppParty(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\+?\d{6,}@/.test(value.trim())) return undefined;
  const v = value
    .replace(/\s+on\s+\d{1,4}[-/ .][A-Za-z0-9]{1,9}[-/ .]\d{2,4}(?:,?\s+(?:at\s+)?\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?[AP]M)?)?\s*$/i, "")
    .replace(/(?:\s+(?:of|on|to|for|no\.?))?\s+\+?\d{7,}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return v.length >= 2 && /[A-Za-z]/.test(v) ? v : undefined;
}

export abstract class AppParser extends KnownBankParser {
  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (!parse) return null;
    if (parse.merchant !== undefined) parse.merchant = cleanAppParty(parse.merchant);
    if (!parse.last4) {
      delete parse.balanceMinor;
      delete parse.availableLimitMinor;
      // No account to book it on: it is always checked in Review, so its score never claims otherwise.
      if (parse.confidence > REVIEW_CEILING) parse.confidence = REVIEW_CEILING;
    }
    return parse;
  }
}
