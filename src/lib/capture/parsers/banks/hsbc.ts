// HSBC India. An account is written "A/c 118-402***-731": only its last three digits show (like ICICI). A NEFT credit
// also names the payer's own account at their bank ("as NEFT from UTIB A/c ***2209 of NAME"), which is never the
// person's. An outgoing NEFT reads "your NEFT transaction ... has been credited to the <bank> A/c XX7710 of NAME":
// money that left, never income, and the beneficiary's account is never last4. A debit card is masked to two digits
// ("XXXXX58xx"), too few to match an account, so a debit card spend carries no digits.

import { cleanParty, KnownBankParser, NAME } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";

// Characters that may sit inside an amount ("42,500.00") without ending a sentence.
const SAME_SENTENCE = String.raw`(?:[^.]|\.(?=\d))`;
const OWN_ACCOUNT = /\bA\/c\s\d{2,4}-\d{2,4}\*{2,6}-(\d{3,4})\b/i;
const OUTWARD = new RegExp(String.raw`\byour\s(?:NEFT|IMPS|RTGS)\stransaction\b${SAME_SENTENCE}{0,120}?\bhas\sbeen\scredited\sto\sthe\s`, "i");
const CARD_THANKS = /\bThank\syou\sfor\susing\s(?:your\s)?HSBC\s(?:Debit|Credit)\sCard\b/i;

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

  protected override direction(text: string): FoundDirection | null {
    // Money that left, whatever "credited" says: it was credited to someone else's account.
    if (OUTWARD.test(text)) return { type: "expense", ambiguous: false };
    if (CARD_THANKS.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // An outgoing NEFT names only the beneficiary's account: no account of the person's is printed.
    if (OUTWARD.test(text)) return null;
    const own = text.match(OWN_ACCOUNT);
    if (own) return { last4: own[1], instrument: "account" };
    const credit = text.match(/\bHSBC\screditcard\s[x*]{2,12}(\d{4})\b/i);
    if (credit) return { last4: credit[1], instrument: "card" };
    // A debit card masked to two digits ("XXXXX58xx"): too few to name an account.
    if (CARD_THANKS.test(text)) return null;
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const patterns = [
      new RegExp(String.raw`\bhas\sbeen\scredited\sto\sthe\s[A-Za-z ]{2,20}\sA\/c\s[X*]{2,14}\d{4}\sof\s${NAME}\s(?:on\s\d|\.|$)`, "i"),
      new RegExp(String.raw`\bas\s(?:NEFT|IMPS|RTGS|UPI)\sfrom\s[A-Za-z]{2,12}\sA\/c\s\*{2,8}\d{3,4}\sof\s${NAME}\s?(?:\.|$)`, "i"),
      new RegExp(String.raw`\bused\sat\s${NAME}\sfor\sINR\b`, "i"),
      new RegExp(String.raw`\bpaid\sfrom\s(?:your\s)?(?:A\/c|account)\s[\dX*-]{4,20}\sto\s${NAME}\son\s\d`, "i"),
      CARD_THANKS.test(text) ? new RegExp(String.raw`\bat\s${NAME}\s?\.(?:\s|$)`, "i") : null,
    ];
    for (const re of patterns) {
      const m = re ? text.match(re) : null;
      const name = cleanParty(m?.[1]);
      if (name) return name;
    }
    return super.merchant(text, type);
  }
}
