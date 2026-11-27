// slice (a small finance bank account, UPI and a credit card). Shapes it sends: "Sent Rs.85 to NAME (UPI transaction
// success). Sent from slice.", "Rs. 67 spent on your credit card xx4417 at SHOP on <date>", "Your slice credit card
// transaction of RS. 899 on shop.in is successful.", "You've got ₹740 from NAME in your slice bank a/c xx4417.", and a
// card bill payment "Repayment of Rs.2,315 received for the slice credit card" (Review, never income). Messages with
// no account digits go to Review. A "Sent ... to" names the payee's account, never the person's, so it gives no digits
// unless it says "from slice a/c".

import { AMT, AppParser, YOUVE } from "./app-shared";
import { cleanParty, NAME, sharedParty } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";

const CARD_TXN = new RegExp(String.raw`\bslice\scredit\scard\stransaction\sof\s${AMT}\son\s(\S{1,60}?)\sis\ssuccessful\b`, "i");
// "You've got ₹740 from NAME in your slice bank a/c xx4417": money received into the account.
const GOT = new RegExp(String.raw`^${YOUVE}\sgot\s${AMT}\sfrom\s${NAME}\sin(?:to)?\syour\sslice\s(?:bank\s)?a\/c\sxx(\d{4})\b`, "i");
const INTO_ACCOUNT = /\bin(?:to)?\syour\sslice\s(?:bank\s)?a\/c\sxx(\d{4})\b/i;

export class SliceParser extends AppParser {
  readonly id = "slice";
  readonly bankName = "slice";
  override readonly senderIds = ["SLCEIT", "SLCBNK"];

  protected readonly shapes = [
    new RegExp(String.raw`^Sent\s${AMT}\sto\s\S[^.(]{0,58}?\s\(UPI\b`, "i"),
    new RegExp(String.raw`\b${AMT}\sspent\son\syour\s(?:slice\s)?credit\scard\sxx\d{4}\sat\s\S`, "i"),
    CARD_TXN,
    GOT,
    /\bfrom\sslice\sa\/c\sxx\d{4}\sto\s\S/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    // "Your slice credit card transaction of RS. 899 on shop.in is successful" carries no debit word.
    if (CARD_TXN.test(text)) return { type: "expense", ambiguous: false };
    if (GOT.test(text)) return { type: "income", ambiguous: false };
    return super.direction(text);
  }

  protected override cardPayment(text: string): boolean {
    if (new RegExp(String.raw`\b(?:re)?payment\sof\s${AMT}\sreceived\sfor\s(?:the\s|your\s)?slice\scredit\scard\b`, "i").test(text)) return true;
    return super.cardPayment(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Money into the account: the slice a/c it went into, not a card it came from.
    const into = type === "income" ? text.match(INTO_ACCOUNT) : null;
    if (into) return { last4: into[1], instrument: "account" };
    // "Sent Rs.500 to a/c XXXX5521": that is the payee's account.
    if (/^Sent\s/i.test(text) && !/\bfrom\sslice\s(?:bank\s)?a\/c\s?xx\d{4}\b/i.test(text)) return null;
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (type === "expense") {
      // "Sent Rs.85 to NAME (UPI ...). Sent from slice.": only the payee position names the payee.
      if (/^Sent\s/i.test(text)) return cleanParty(text.match(new RegExp(String.raw`^Sent\s${AMT}\sto\s(\S[^.(;]{0,58}?)\s\(`, "i"))?.[1]);
      return cleanParty(text.match(CARD_TXN)?.[1]) ?? super.merchant(text, type);
    }
    return cleanParty(text.match(GOT)?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
