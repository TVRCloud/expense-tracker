// LazyPay, a pay-later credit line. A purchase "Your txn TXN5812640 of Rs. 236.40 on SHOP was successful" is a spend
// on that line; it has no account number, so it goes to Review. A repayment to LazyPay settles the line, like a card
// bill: a card payment in Review, never income.

import { AMT, AppParser } from "./app-shared";
import { cleanParty, NAME } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";

const PURCHASE = new RegExp(String.raw`\b(?:txn|transaction|payment)\b[^.]{0,40}?\b${AMT}\b[^.]{0,40}?\bon\s${NAME}\swas\ssuccessful\b`, "i");
const REPAY = new RegExp(String.raw`\brepayment\sof\s${AMT}\b|\b(?:payment|amount)\sof\s${AMT}\s(?:has\sbeen\s)?received\stowards\syour\sLazyPay\b`, "i");

export class LazyPayParser extends AppParser {
  readonly id = "lazypay";
  readonly bankName = "LazyPay";
  override readonly senderIds = ["LZYPAY"];

  protected readonly shapes = [PURCHASE, REPAY];

  protected override direction(text: string): FoundDirection | null {
    if (PURCHASE.test(text) && !/\brefund(?:ed)?\b|\breversed\b/i.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override cardPayment(text: string): boolean {
    return REPAY.test(text) || super.cardPayment(text);
  }

  protected override account(): FoundAccount | null {
    return null;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    return cleanParty(text.match(PURCHASE)?.[1]) ?? super.merchant(text, type);
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\b(TXN\d{6,20})\b/i)?.[1] ?? super.ref(text);
  }
}
