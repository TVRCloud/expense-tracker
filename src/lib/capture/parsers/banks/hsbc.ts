// HSBC India. An account is written "A/c 118-402***-731": only its last three digits show (like ICICI). A NEFT alert
// also names the other party's account at their bank ("as NEFT from UTIB A/c ***2271 of NAME"), which is never the
// person's. An outgoing NEFT reads "your NEFT transaction ... has been credited to the <bank> A/c XX7710 of NAME":
// money that left, never income, and the beneficiary's account is never last4. A debit card is often masked to two
// digits ("XXXXX58xx"), too few to match an account, so such a spend carries no digits.

import { cleanParty, KnownBankParser, NAME, REVIEW_CEILING, vpaAfter } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import type { MoneyParse } from "../types";

// Characters that may sit inside an amount ("42,500.00") without ending a sentence.
const SAME_SENTENCE = String.raw`(?:[^.]|\.(?=\d))`;
// The person's own account. One followed by "of NAME" is someone else's.
const OWN_ACCOUNT = /\bA\/c\s\d{2,4}-\d{2,4}\*{2,6}-(\d{3,4})\b(?!\sof\s)/i;
// Words that say money came back or a transfer did not go through. When one of them appears anywhere in the message
// (a shop or payee name included), the read is held in Review rather than trusted either way (ticket 174 review).
// Shared by both lists: reversals, refunds, reimbursements, chargebacks, cancellations, voids, bounces, roll-backs and
// any credit (never "Credit Card" or "creditcard", which every card alert names).
const BACK_WORDS = String.raw`revers\w*|refund\w*|reimburs\w*|charge-?back|cancel(?:l?ed|lation)|void(?:ed)?|bounced|rolled\sback|adjusted\sback|re-?credited|credited\sback|credit(?!\s?card)|cr`;
const MONEY_BACK = new RegExp(
  String.raw`\b(?:${BACK_WORDS}|failed|unsuccessful|returned|rejected|declined|could\snot\sbe\s(?:processed|completed)|not\sprocessed)\b`,
  "i"
);
// The same for a card alert, plus "credited": on a card alert any credit is money back or a promo.
const CARD_BACK = new RegExp(String.raw`\b(?:${BACK_WORDS}|credited|returned|failed|declined)\b`, "i");
// "has been credited to the A/c 118-402***-731": credited back to the person's own account, never money out. Not when
// "of NAME" follows: that is someone else's account in the same format.
const BACK_TO_OWN = /\bhas\s(?:now\s)?been\scredited\sto\s(?:the|your)\sA\/c\s\d{2,4}-\d{2,4}\*{2,6}-\d{3,4}\b(?!\sof\s)/i;
// The shop a card alert names: "at ORCHID MART ." / "at ORCHID MART has been reversed" / "at X on 07-Nov-26".
const SHOP = /\b(?:used\s)?at\s(?!\d{1,2}[.:]\d{2})(\S(?:[^.;]|\.(?=\S)){0,58}?)(?=\s(?:(?:has|have|was|is)\b|for\sINR\b|on\s\d)|\s?\.(?:\s|$)|$)/i;
// The payee of an outgoing transfer: "A/c XXXXXXXX4407 of SUNIL BHAT".
const PAYEE = /\bA\/c\s[\dX*-]{4,20}\sof\s(\S[^.;]{0,58}?)(?=\son\s\d|\s?\.(?:\s|$)|$)/i;
const OUTWARD = new RegExp(String.raw`\byour\s(?:NEFT|IMPS|RTGS)\stransaction\b${SAME_SENTENCE}{0,120}?\bhas\s(?:now\s)?been\scredited\sto\sthe\s`, "i");
const CARD_THANKS = /\bThank\syou\sfor\susing\s(?:your\s)?HSBC\s(?:Debit|Credit)\sCard\b/i;
// "Credit Card XXXX6603", "creditcard xxxxx5832": a card with its last four digits.
const CARD_FOUR = /\bHSBC\s(?:debit|credit)\s?card\s[x*]{2,12}(\d{4})\b/i;
// "Debit Card XXXXX58xx": fewer than four digits show.
const CARD_PARTIAL = /\bHSBC\s(?:debit|credit)\s?card\s[x*]{2,12}\d{1,3}[x*]{1,4}(?![\w])/i;
// A time of day a bank writes where a name could sit ("at 10.02.11", "at 18:42").
const TIME_FIRST = /^\d{1,2}[.:]\d{2}(?:[.:]\d{2})?\b/;
// What is left of "towards NACH mandate verification" once the mandate words go: a step, never a payee.
// "ORCHID MART reversed", "ORCHID MART - REVERSED", "SUNIL BHAT, returned": the status, never part of the name.
const STATUS_TAIL = /[\s,;-]{1,4}(?:(?:stands|got|was|has\sbeen|is)\s)?(?:revers\w*|refund\w*|returned|failed|cancel\w*|voided|bounced)\b.{0,80}$/i;
const MANDATE_STEP = /^(?:verification|registration|set\s?-?up|creation)$/i;
/** "UPI mandate set up for TUNEWAVE" -> "TUNEWAVE", "NACH mandate verification" -> "". */
function dropMandateWords(name: string | undefined): string | undefined {
  return name?.replace(/^(?:(?:UPI|NACH|ECS)\s)?(?:e-?mandate|mandate|auto\s?pay)\s(?:(?:set\s?-?up|registration|verification|creation)\s?)?(?:for\s)?/i, "");
}
// "Your HSBC creditcard xxxxx6603 payment of INR ... has been received": a bill payment, written with "creditcard".
const CARD_BILL = /\bHSBC\scredit\s?card\s[x*]{2,12}\d{4}\spayment\sof\sINR\s?[\d,.]{1,15}\s[^.]{0,40}?\breceived\b/i;

export class HsbcParser extends KnownBankParser {
  readonly id = "hsbc";
  readonly bankName = "HSBC";
  override readonly senderIds = ["HSBCIN"];

  protected readonly shapes = [
    /^HSBC:\sA\/c\s\d{2,4}-\d{2,4}\*{2,6}-\d{3,4}\sis\s(?:credited|debited)\swith\sINR\s[\d,.]{1,15}\s/i,
    /^HSBC:\sINR\s[\d,.]{1,15}\sis\s(?:credited\sto|paid\sfrom)\syour\sA\/c\s\d{2,4}-\d{2,4}\*{2,6}-\d{3,4}\b/i,
    /^HSBC:\sINR\s[\d,.]{1,15}\sis\spaid\sfrom\saccount\s[X*]{2,12}\d{4}\sto\s/i,
    /^(?:HSBC:\s)?Thank\syou\sfor\susing\sHSBC\s(?:Debit|Credit)\sCard\s[X*x\d]{4,16}\s/i,
    /^Your\sHSBC\screditcard\s[x*]{2,12}\d{4}\sused\sat\s/i,
  ];

  /** Money sent to someone else's account. Only an HSBC-format account of the person's own after "credited to" makes
   * it money back; anything else that also talks of a failure or a return stays money out, held in Review (`parse`). */
  private outward(text: string): boolean {
    return OUTWARD.test(text) && !BACK_TO_OWN.test(text);
  }

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    // A line break ends a sentence ("...\nat ORCHID MART\nTransaction reversed") before whitespace is collapsed.
    const lined = text.replace(/\.?[ \t]*(?:\r?\n)+[ \t]*/g, ". ");
    const parse = super.parse(lined, receivedAt);
    if (!parse) return null;
    const flat = lined.replace(/\s+/g, " ").trim();
    // A card alert or an outgoing transfer that says anything of money coming back, anywhere, shop and payee names
    // included, is never trusted either way: Review. A shop called "REFUND KITCHEN" goes to Review too (accepted).
    const held = (CARD_THANKS.test(flat) && CARD_BACK.test(flat)) || (this.outward(flat) && MONEY_BACK.test(flat));
    return held && parse.confidence > REVIEW_CEILING ? { ...parse, confidence: REVIEW_CEILING } : parse;
  }

  protected override direction(text: string): FoundDirection | null {
    // Money that left, whatever "credited" says: it was credited to someone else's account.
    if (this.outward(text)) return { type: "expense", ambiguous: false };
    // A card used, unless any money-back word appears: then the shared reading, held in Review by \`parse\`.
    if (CARD_THANKS.test(text)) {
      if (!CARD_BACK.test(text)) return { type: "expense", ambiguous: false };
      // A money-back word the shared reader cannot place ("will be reversed in 7 days"): the card was used; Review.
      return super.direction(text) ?? { type: "expense", ambiguous: true };
    }
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const own = text.match(OWN_ACCOUNT);
    if (own) return { last4: own[1], instrument: "account" };
    // An outgoing NEFT with no account of the person's printed names only the beneficiary's.
    if (this.outward(text)) return null;
    const card = text.match(CARD_FOUR);
    if (card) return { last4: card[1], instrument: "card" };
    // A card masked to fewer than four digits, or a card alert naming no card: never digits from a ref or elsewhere.
    if (CARD_PARTIAL.test(text) || CARD_THANKS.test(text)) return null;
    return super.account(text, type);
  }

  protected override cardPayment(text: string): boolean {
    return CARD_BILL.test(text) || super.cardPayment(text);
  }

  protected override paidCard(text: string): FoundAccount | null {
    const card = text.match(CARD_FOUR);
    return card ? { last4: card[1], instrument: "card" } : super.paidCard(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const patterns = [
      new RegExp(String.raw`\bhas\sbeen\scredited\sto\sthe\s[A-Za-z ]{2,20}\sA\/c\s[X*]{2,14}\d{4}\sof\s${NAME}\s(?:on\s\d|\.|$)`, "i"),
      // "as NEFT from UTIB A/c ***2271 of NAME" (a credit) or "as NEFT to SBIN A/c ***9018 of NAME" (a debit).
      new RegExp(String.raw`\bas\s(?:NEFT|IMPS|RTGS|UPI)\s(?:from|to)\s[A-Za-z]{2,12}\sA\/c\s\*{2,8}\d{3,4}\sof\s${NAME}\s?(?:\.|$)`, "i"),
      new RegExp(String.raw`\bused\sat\s${NAME}\sfor\sINR\b`, "i"),
      new RegExp(String.raw`\bpaid\sfrom\s(?:your\s)?(?:A\/c|account)\s[\dX*-]{4,20}\sto\s${NAME}\son\s\d`, "i"),
      new RegExp(String.raw`\btowards\s${NAME}\s?(?:\.\s|\.$|$)`, "i"),
      CARD_THANKS.test(text) ? SHOP : null,
      PAYEE,
    ];
    for (const re of patterns) {
      const m = re ? text.match(re) : null;
      // "towards UPI mandate set up for STREAMFLIX": the payee after the mandate words; "towards NACH mandate
      // verification" names none.
      const raw = dropMandateWords(m?.[1]);
      const name = raw && MANDATE_STEP.test(raw) ? undefined : cleanParty(raw);
      // A time of day or a cash deposit is never a payee; a status word after the name is not part of it.
      const trimmed = name ? cleanParty(name.replace(STATUS_TAIL, "")) : undefined;
      if (trimmed && !TIME_FIRST.test(trimmed) && !/^cash\s/i.test(trimmed)) return trimmed;
    }
    const vpa = vpaAfter(type === "expense" ? "to" : "from", text);
    if (vpa) return vpa;
    const shared = super.merchant(text, type);
    // The shared rule can stop on a time of day ("at 10.02.11 with UTR ...") or leave a mandate step
    // ("verification"): never a name.
    const rest = dropMandateWords(shared);
    return shared && rest && !TIME_FIRST.test(shared) && !MANDATE_STEP.test(rest) ? shared : undefined;
  }
}
