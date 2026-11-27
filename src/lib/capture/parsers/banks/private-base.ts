// What the private bank parsers (ticket 172) share on top of KnownBankParser: a debit with a word that says it was
// undone anywhere in the message ("reversed", "refunded", "returned unpaid", "bounced") is never booked as spending;
// it is checked in Review.
// (The generic parser books some of these; that shared rule is tracked by the phase 9 tracker, not changed here.)

import type { MoneyParse } from "../types";
import { KnownBankParser, REVIEW_CEILING } from "./known";

// Anywhere in the message, the payee's name included: a payee called "REVERSAL CAFE" also goes to Review (accepted
// noise; never booking an undone debit matters more).
const UNDONE_DEBIT = /\b(?:revers(?:ed|al)|refunded|returned\sunpaid|bounced|charged\sback|chargeback)\b/i;

export abstract class PrivateBankParser extends KnownBankParser {
  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (parse && parse.type === "expense" && UNDONE_DEBIT.test(text) && parse.confidence > REVIEW_CEILING) {
      return { ...parse, confidence: REVIEW_CEILING };
    }
    return parse;
  }
}
