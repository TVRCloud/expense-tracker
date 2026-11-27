// American Express India. Every alert is about a card, printed with its last five digits ("AMEX card ** 45832"); the
// last four are kept, the length every other card uses for matching. A payment towards the card is a card bill
// payment (the shared rule, capped and kept in Review).

import { cleanParty, KnownBankParser, NAME } from "./known";
import type { FoundAccount } from "../extract/account";

const CARD = /\b(?:AMEX|American\sExpress)\scard\s(?:ending\s(?:in\s)?|\*{1,4}\s?)\d{0,2}(\d{4})\b/i;
// "Your payment of INR ... towards your American Express Card ... has been received": a bill payment.
const BILL_PAID = /\bpayment\sof\sINR\s?[\d,.]{1,15}\stowards\syour\s(?:AMEX|American\sExpress)\scard\b[^.]{0,60}?\breceived\b/i;

export class AmexParser extends KnownBankParser {
  readonly id = "amex";
  readonly bankName = "American Express";
  override readonly senderIds = ["AMEXIN"];

  protected readonly shapes = [
    /\bspent\sINR\s[\d,.]{1,15}\son\syour\sAMEX\scard\s\*{1,4}\s?\d{4,5}\sat\s/i,
    /\breceived\s(?:a\s)?payment\sof\sINR\s[\d,.]{1,15}\stowards\syour\sAMEX\scard\s\*{1,4}\s?\d{4,5}\b/i,
    BILL_PAID,
  ];

  protected override cardPayment(text: string): boolean {
    return BILL_PAID.test(text) || super.cardPayment(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const card = text.match(CARD);
    return card ? { last4: card[1], instrument: "card" } : super.account(text, type);
  }

  protected override paidCard(text: string): FoundAccount | null {
    const card = text.match(CARD);
    return card ? { last4: card[1], instrument: "card" } : super.paidCard(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const shop = text.match(new RegExp(String.raw`\bAMEX\scard\s\*{1,4}\s?\d{4,5}\sat\s${NAME}\son\s\d{1,2}\s[A-Za-z]{3,9}\b`, "i"));
    return cleanParty(shop?.[1]) ?? super.merchant(text, type);
  }
}
