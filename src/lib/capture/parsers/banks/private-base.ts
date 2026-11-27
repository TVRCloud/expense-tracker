// What the private bank parsers (ticket 172) share on top of KnownBankParser: a debit the message itself says was
// undone ("debited ... has been reversed", "debit reversal") is never booked as spending; it is checked in Review.
// (The generic parser books some of these; that shared rule is tracked by the phase 9 tracker, not changed here.)

import type { MoneyParse } from "../types";
import { KnownBankParser, REVIEW_CEILING } from "./known";

const UNDONE_DEBIT = /\b(?:has\sbeen|is|was|been)\sreversed\b|\breversal\b|\breturned\sunpaid\b/i;

export abstract class PrivateBankParser extends KnownBankParser {
  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    // Tested without the payee's own name, so "REVERSAL CAFE" or "RETURNED UNPAID LOGISTICS" are still payees.
    const rest = parse?.merchant ? text.split(parse.merchant).join(" ") : text;
    if (parse && parse.type === "expense" && UNDONE_DEBIT.test(rest) && parse.confidence > REVIEW_CEILING) {
      return { ...parse, confidence: REVIEW_CEILING };
    }
    return parse;
  }
}
