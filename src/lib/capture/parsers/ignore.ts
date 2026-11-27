// Messages that must never become transactions (OTPs, offers, due reminders, failed payments). Runs before any
// parser, so a bank parser never has to repeat these checks.

import { CREDIT_WORDS, DEBIT_WORDS, isCardUse, txnDidNotGoThrough } from "./extract/direction";
import type { IgnoredParse } from "./types";

/** A fraud warning many alerts end with ("Never share OTP/PIN with anyone"). Removed before the OTP check, so a
 * real debit that carries it is not thrown away as an OTP. Same rule as the phone's `CaptureFilter.OTP_WARNING`. */
const OTP_WARNING =
  /(?:\bdo\s*n[o'’]?t|\bdon[’']t|\bnever|\bnot|\bbeware|\bbanks?\s+never)\s+(?:to\s+)?(?:share|ask|disclose|reveal|give|tell)[^.\n\d]*/gi;

export function ignoreReason(text: string): IgnoredParse["reason"] | null {
  // The warning is cut only up to the first digit, and a 4 to 8 digit code right after "OTP" (or "123456 is your
  // OTP") is always an OTP: "Don't share this OTP 123456 for txn of Rs 500" stays ignored. A merchant's "Auth code" or
  // "Approval code" is not an OTP.
  if (
    /\b(?:OTP|(?:verification|security|secret|one[\s-]?time)\s+code)\b\D{0,20}\b\d{4,8}\b|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:OTP|verification\s+code)\b/i.test(
      text
    )
  ) {
    return "otp";
  }
  if (/\bOTP\b|one[\s-]?time\s+pass(word|code)|verification code|\bcode is\b/i.test(text.replace(OTP_WARNING, " "))) {
    return "otp";
  }
  // Money that already moved: a past-tense debit or credit ("if debited" is a promise, not a debit).
  const movedVerb =
    /(?<!\bif\s+(?:the\s+)?(?:amount\s+)?(?:is\s+|gets\s+)?|\b(?:will|to|shall)\s+be\s+|\b(?:request|mandate)\s+(?:has\s+been\s+|is\s+|was\s+)?)\b(debited|spent|deducted|withdrawn|wdl|sent|paid|transferred|received|deposited|credited|reversed|debit by transfer|has been refunded|is refunded|refunded to)\b/i.test(
      text
    );
  // A card spend written with no money verb ("Thank you for using … Card … for INR 845.00") moved money too, so a help
  // line ("SMS BLOCK … to get any failed or disputed txn checked") or a refund still to come never drops it, unless
  // the message says the transaction itself did not go through (ticket 177).
  const moved = movedVerb || (isCardUse(text) && !txnDidNotGoThrough(text));
  // A notice before a debit (RBI pre-debit and mandate alerts), or a debit that could not happen, moved nothing.
  // A pre-debit notification never moves money, whatever else it says ("mandate received on ...").
  if (/\bpre-?debit\b/i.test(text)) return "reminder";
  // "Scheduled" and "upcoming" are a reminder unless a money verb says otherwise; a card spend whose refund "will be
  // credited" is not (ticket 177).
  if (/\b(scheduled|upcoming|insufficient (?:balance|funds))\b/i.test(text) && !movedVerb) return "reminder";
  if (/\b(?:will|to) be (?:debited|credited|processed|deducted|charged|presented)\b/i.test(text) && !moved) return "reminder";
  // A payment that did not go through moved no money. Only when nothing says money moved: "Rs 500 debited ...
  // UPI txn failed? Call 1800" is a real debit with a help line, and "Rs 799 reversed ... for failed UPI txn" a credit.
  if (/\b(failed|declined|unsuccessful|could not be (?:processed|completed)|has been rejected)\b/i.test(text) && !moved) {
    return "not_financial";
  }
  // The transaction itself was declined and no money verb says anything moved: nothing to read. With a money verb
  // ("Rs 540 debited … Txn declined? Call …", "… your previous attempt was declined") the read goes to Review at 0.5
  // instead (base.ts), never dropped (ticket 177).
  if (!movedVerb && txnDidNotGoThrough(text) && !/\b(?:reversed|refund(?:ed)?|credited\s+back|reversal)\b/i.test(text)) {
    return "not_financial";
  }
  const hasMovement = DEBIT_WORDS.test(text) || CREDIT_WORDS.test(text);
  if (
    /\b(requested|collect request|request of)\b/i.test(text) &&
    !/\b(debited|credited)\b/i.test(text)
  ) {
    return "not_financial";
  }
  if (
    /\b(is due|due on|due date|due by|minimum amount due|min\.? amt due|total amount due|bill (is )?generated|statement (is )?generated)\b/i.test(text) &&
    !/\b(debited|spent|credited|received)\b/i.test(text)
  ) {
    return "reminder";
  }
  if (
    /\b(pre-?approved|offer|apply now|click here|limited time|win|voucher|upgrade)\b/i.test(text) &&
    !hasMovement
  ) {
    return "promo";
  }
  return null;
}
