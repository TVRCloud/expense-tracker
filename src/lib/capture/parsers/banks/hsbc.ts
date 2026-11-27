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
const OWN_ACCOUNT = /\bA\/c\s\d{2,4}-\d{2,4}\*{2,6}-(\d{3,4})\b/i;
// Words that say money came back or a transfer did not go through. Only tested on what the message says happened
// (`statedBack`): never inside a payee or shop name, a condition ("If it has failed ..."), a help line or a promo.
const MONEY_BACK =
  /\b(?:revers(?:ed|al)|refund(?:ed)?|credited\sback|failed|unsuccessful|returned|rejected|declined|could\snot\sbe\s(?:processed|completed)|not\sprocessed)\b/i;
// A sentence that is not about what happened: a condition, a help line, a promo, cashback or reward points, or
// something still to come ("The amount will be reversed in 7 days").
const NOT_WHAT_HAPPENED =
  /^(?:If|Report|Call|SMS|Never|Do\snot|Don't|To\s|For\s(?:help|queries|assistance)|Get|Earn|Pay|Use|Click|Download|Visit|Know|T&C)\b|\b(?:cashback|reward|points?|offer|eligible|will|shall)\b/i;
// "has been credited to the A/c 118-402***-731": credited back to the person's own account, never money out.
const BACK_TO_OWN = /\bhas\s(?:now\s)?been\scredited\sto\s(?:the|your)\sA\/c\s\d{2,4}-\d{2,4}\*{2,6}-\d{3,4}\b/i;
const OUTWARD = new RegExp(String.raw`\byour\s(?:NEFT|IMPS|RTGS)\stransaction\b${SAME_SENTENCE}{0,120}?\bhas\s(?:now\s)?been\scredited\sto\sthe\s`, "i");
const CARD_THANKS = /\bThank\syou\sfor\susing\s(?:your\s)?HSBC\s(?:Debit|Credit)\sCard\b/i;
// "Credit Card XXXX6603", "creditcard xxxxx5832": a card with its last four digits.
const CARD_FOUR = /\bHSBC\s(?:debit|credit)\s?card\s[x*]{2,12}(\d{4})\b/i;
// "Debit Card XXXXX58xx": fewer than four digits show.
const CARD_PARTIAL = /\bHSBC\s(?:debit|credit)\s?card\s[x*]{2,12}\d{1,3}[x*]{1,4}(?![\w])/i;
// A time of day a bank writes where a name could sit ("at 10.02.11", "at 18:42").
const TIME_FIRST = /^\d{1,2}[.:]\d{2}(?:[.:]\d{2})?\b/;
// What is left of "towards NACH mandate verification" once the mandate words go: a step, never a payee.
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

  /** Whether the message itself says money came back: names (after "of", "at", "used at") and sentences that are
   * conditions, help lines, promos, cashback or points are taken out first. */
  private statedBack(text: string): boolean {
    const scrubbed = text
      .replace(/\bof\s[^.]{1,60}?(?=\son\s\d|\s?\.(?:\s|$)|$)/gi, "of <name>")
      .replace(/\b(?:used\s)?at\s(?!\d{1,2}[.:]\d{2})[^.]{1,60}?(?=\sfor\sINR\b|\son\s\d|\s?\.(?:\s|$)|$)/gi, "at <shop>")
      .replace(/\btowards\s[^.]{1,60}?(?=\s?\.(?:\s|$)|$)/gi, "towards <payee>");
    return scrubbed
      .split(/(?<!\b(?:Rs|no|Avl|Bal|Txn|INR))\.\s+(?=[A-Z])/)
      .some((sentence) => !NOT_WHAT_HAPPENED.test(sentence.trim()) && MONEY_BACK.test(sentence));
  }

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (!parse) return null;
    const flat = text.replace(/\s+/g, " ").trim();
    // Money sent out that the message also says failed or came back, without naming the person's own account: Review.
    if (this.outward(flat) && this.statedBack(flat) && parse.confidence > REVIEW_CEILING) return { ...parse, confidence: REVIEW_CEILING };
    return parse;
  }

  protected override direction(text: string): FoundDirection | null {
    // Money that left, whatever "credited" says: it was credited to someone else's account.
    if (this.outward(text)) return { type: "expense", ambiguous: false };
    // A card used, unless the message itself says the money came back ("The transaction has been reversed.").
    if (CARD_THANKS.test(text)) return this.statedBack(text) ? { type: "income", ambiguous: false } : { type: "expense", ambiguous: false };
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
      CARD_THANKS.test(text) ? new RegExp(String.raw`\bat\s(?!\d{1,2}[.:]\d{2})${NAME}\s?(?:\.|\son\s\d|$)`, "i") : null,
    ];
    for (const re of patterns) {
      const m = re ? text.match(re) : null;
      // "towards UPI mandate set up for STREAMFLIX": the payee after the mandate words; "towards NACH mandate
      // verification" names none.
      const raw = dropMandateWords(m?.[1]);
      const name = raw && MANDATE_STEP.test(raw) ? undefined : cleanParty(raw);
      // A time of day or a cash deposit is never a payee.
      if (name && !TIME_FIRST.test(name) && !/^cash\s/i.test(name)) return name;
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
