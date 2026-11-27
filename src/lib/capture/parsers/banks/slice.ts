// slice (a small finance bank account, UPI and a credit card). Shapes it sends: "Sent Rs.85 to NAME (UPI transaction
// success). Sent from slice.", "Rs. 67 spent on your credit card xx4417 at SHOP on <date>", "Your slice credit card
// transaction of RS. 899 on shop.in is successful.", "You've got ₹740 from NAME in your slice bank a/c xx4417.", and a
// card bill payment "Repayment of Rs.2,315 received for the slice credit card" (Review, never income). Messages with
// no account digits go to Review.

import { AMT, AppParser } from "./app-shared";
import { cleanParty, NAME, sharedParty } from "./known";
import type { FoundDirection } from "../extract/direction";

const CARD_TXN = new RegExp(String.raw`\bslice\scredit\scard\stransaction\sof\s${AMT}\son\s(\S{1,60}?)\sis\ssuccessful\b`, "i");

export class SliceParser extends AppParser {
  readonly id = "slice";
  readonly bankName = "slice";
  override readonly senderIds = ["SLICEIT", "SLCEIT", "SLCBNK"];

  protected readonly shapes = [
    new RegExp(String.raw`^Sent\s${AMT}\sto\s\S[^.(]{0,58}?\s\(UPI\b`, "i"),
    new RegExp(String.raw`\b${AMT}\sspent\son\syour\s(?:slice\s)?credit\scard\sxx\d{4}\sat\s\S`, "i"),
    CARD_TXN,
    /\bin\syour\sslice\s(?:bank\s)?a\/c\sxx\d{4}\b/i,
    /\bfrom\sslice\sa\/c\sxx\d{4}\sto\s\S/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    // "Your slice credit card transaction of RS. 899 on shop.in is successful" carries no debit word.
    if (CARD_TXN.test(text)) return { type: "expense", ambiguous: false };
    if (/\byou'?ve\sgot\s/i.test(text)) return { type: "income", ambiguous: false };
    return super.direction(text);
  }

  protected override cardPayment(text: string): boolean {
    if (new RegExp(String.raw`\b(?:re)?payment\sof\s${AMT}\sreceived\sfor\s(?:the\s|your\s)?slice\scredit\scard\b`, "i").test(text)) return true;
    return super.cardPayment(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (type === "expense") {
      const sent = text.match(new RegExp(String.raw`^Sent\s${AMT}\sto\s(\S[^.(;]{0,58}?)\s\(`, "i"));
      const online = text.match(CARD_TXN);
      return cleanParty(sent?.[1]) ?? cleanParty(online?.[1]) ?? super.merchant(text, type);
    }
    const got = text.match(new RegExp(String.raw`\bfrom\s${NAME}\sin\syour\sslice\b`, "i"));
    return cleanParty(got?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
