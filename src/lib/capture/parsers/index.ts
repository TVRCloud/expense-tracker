// Turns bank / UPI message text (SMS or app notification) into structured
// data. Lives in the codebase, not in n8n or the phone, so every capture
// source shares one versioned, tested parser.
//
// Order matters: messages that must never become transactions (OTPs,
// offers, due reminders) are filtered first (ignore.ts), then the exact known
// formats whatever the sender (formats.ts), then the parser of the bank that
// sent it, picked by sender (registry.ts), then the generic parser for the
// common Indian bank phrasing (generic.ts). Every result carries a confidence from 0 to 1; ingest
// only auto-creates a transaction at CONFIDENCE_AUTO_CREATE or above and
// queues the rest for review.

import type { BankParser } from "./base";
import { parseIdfcCardSpend, parseLoanEmi } from "./formats";
import { genericParser } from "./generic";
import { ignoreReason } from "./ignore";
import { BANK_PARSERS, findBankParser } from "./registry";
import type { CaptureParse, MessageSource } from "./types";

export { CONFIDENCE_AUTO_CREATE, PARSER_VERSION } from "./types";
export type { CaptureParse, IgnoredParse, LoanEmiParse, MessageSource, MoneyParse, UnknownParse } from "./types";
export { toMinorUnits } from "./extract/amount";
export { isAtmWithdrawal, isCardPayment } from "./extract/direction";
export { BankParser } from "./base";
export { BANK_PARSERS, findBankParser, normaliseSender } from "./registry";

/** Parser ids that are not a bank parser: the ignore checks, the exact formats, the generic parser and "none". */
export const SHARED_PARSER_IDS: ReadonlySet<string> = new Set(["ignore", "navi_emi", "idfc_card_spend", "generic", "none"]);

/** A parse function over a given set of bank parsers. `parseCapture` is this over BANK_PARSERS; tests pass their own. */
export function createCaptureParser(parsers: readonly BankParser[]) {
  return function parse(raw: string, receivedAt: Date = new Date(), source?: MessageSource): CaptureParse {
    // Styled Unicode letters (mathematical bold, full width) read as plain text, so an OTP written in them is still
    // ignored and a bank alert in them is still read.
    const text = raw.normalize("NFKC");
    const reason = ignoreReason(text);
    if (reason) return { kind: "ignored", parserId: "ignore", confidence: 1, reason };

    return (
      parseLoanEmi(text) ??
      parseIdfcCardSpend(text, receivedAt) ??
      findBankParser(source, parsers)?.parse(text, receivedAt) ??
      genericParser.parse(text, receivedAt) ?? { kind: "unknown", parserId: "none", confidence: 0 }
    );
  };
}

export const parseCapture = createCaptureParser(BANK_PARSERS);
