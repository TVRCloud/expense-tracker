// HSBC India. An account is written "A/c 118-402***-731": only its last three digits show (like ICICI). A NEFT alert
// also names the other party's account at their bank ("as NEFT from UTIB A/c ***2271 of NAME"), which is never the
// person's. An outgoing NEFT reads "your NEFT transaction ... has been credited to the <bank> A/c XX7710 of NAME":
// money that left, never income, and the beneficiary's account is never last4. A debit card is often masked to two
// digits ("XXXXX58xx"), too few to match an account, so such a spend carries no digits.

import { cleanParty, KnownBankParser, NAME, vpaAfter } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";

// Characters that may sit inside an amount ("42,500.00") without ending a sentence.
const SAME_SENTENCE = String.raw`(?:[^.]|\.(?=\d))`;
const OWN_ACCOUNT = /\bA\/c\s\d{2,4}-\d{2,4}\*{2,6}-(\d{3,4})\b/i;
// Money back or a transfer that did not go through: never read as money out.
const MONEY_BACK =
  /\b(?:revers(?:ed|al)|refund(?:ed)?|failed|unsuccessful|returned|rejected|declined|could\snot\sbe\s(?:processed|completed)|not\sprocessed)\b/i;
// "has been credited to the A/c 118-402***-731": credited back to the person's own account, never money out.
const BACK_TO_OWN = /\bhas\sbeen\scredited\sto\s(?:the|your)\sA\/c\s\d{2,4}-\d{2,4}\*{2,6}-\d{3,4}\b/i;
const OUTWARD = new RegExp(String.raw`\byour\s(?:NEFT|IMPS|RTGS)\stransaction\b${SAME_SENTENCE}{0,120}?\bhas\sbeen\scredited\sto\sthe\s`, "i");
const CARD_THANKS = /\bThank\syou\sfor\susing\s(?:your\s)?HSBC\s(?:Debit|Credit)\sCard\b/i;
// "Credit Card XXXX6603", "creditcard xxxxx5832": a card with its last four digits.
const CARD_FOUR = /\bHSBC\s(?:debit|credit)\s?card\s[x*]{2,12}(\d{4})\b/i;
// "Debit Card XXXXX58xx": fewer than four digits show.
const CARD_PARTIAL = /\bHSBC\s(?:debit|credit)\s?card\s[x*]{2,12}\d{1,3}[x*]{1,4}(?![\w])/i;
// A time of day a bank writes where a name could sit ("at 10.02.11", "at 18:42").
const TIME_FIRST = /^\d{1,2}[.:]\d{2}(?:[.:]\d{2})?\b/;
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

  private outward(text: string): boolean {
    return OUTWARD.test(text) && !MONEY_BACK.test(text) && !BACK_TO_OWN.test(text);
  }

  protected override direction(text: string): FoundDirection | null {
    // Money that left, whatever "credited" says: it was credited to someone else's account.
    if (this.outward(text)) return { type: "expense", ambiguous: false };
    // A card used, unless the same message says the money came back.
    if (CARD_THANKS.test(text) && !MONEY_BACK.test(text) && !/\bcredited\b/i.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const own = text.match(OWN_ACCOUNT);
    if (own) return { last4: own[1], instrument: "account" };
    // An outgoing NEFT with no account of the person's printed names only the beneficiary's.
    if (this.outward(text)) return null;
    const card = text.match(CARD_FOUR);
    if (card) return { last4: card[1], instrument: "card" };
    // A card masked to fewer than four digits: too few to name an account.
    if (CARD_PARTIAL.test(text)) return null;
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
      const name = cleanParty(m?.[1]);
      // A time of day or a cash deposit is never a payee.
      if (name && !TIME_FIRST.test(name) && !/^cash\s/i.test(name)) return name;
    }
    const vpa = vpaAfter(type === "expense" ? "to" : "from", text);
    if (vpa) return vpa;
    const shared = super.merchant(text, type);
    // The shared rule can stop on a time of day ("at 10.02.11 with UTR ..."): never a name.
    return shared && !TIME_FIRST.test(shared) ? shared : undefined;
  }
}
