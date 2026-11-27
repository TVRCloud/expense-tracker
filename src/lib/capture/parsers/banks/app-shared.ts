// What the payment app, wallet and card app parsers share (ticket 175). Apps rarely print the person's account: a
// wallet or a pay-later line has no account number, and an app's copy of a UPI payment would only repeat the bank's
// own message. So these parsers never invent digits, and a figure such as a wallet balance with no account to belong
// to is dropped rather than kept on a parse a later step might attach to a guessed account.

import { KnownBankParser, REVIEW_CEILING } from "./known";
import type { MoneyParse } from "../types";

/** An amount as printed: "Rs.1,265.30", "₹ 97", "INR 43". */
export const AMT = String.raw`(?:Rs\.?|INR|₹)\s?\d[\d,]{0,11}(?:\.\d{1,2})?`;

export abstract class AppParser extends KnownBankParser {
  /** The highest score this app's reads may keep (1 for none). */
  protected readonly ceiling: number = 1;

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (!parse) return null;
    if (!parse.last4) {
      delete parse.balanceMinor;
      delete parse.availableLimitMinor;
      // No account to book it on: it is always checked in Review, so its score never claims otherwise.
      if (parse.confidence > REVIEW_CEILING) parse.confidence = REVIEW_CEILING;
    }
    if (parse.confidence > this.ceiling) parse.confidence = this.ceiling;
    return parse;
  }
}
