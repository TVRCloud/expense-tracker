// ICICI Bank. Its alerts mask an account to three digits ("Acct XX051"), name a UPI payee before "credited" ("...;
// CORNER CAFE credited."), name a NACH, NEFT or bill payee after "Info" ("InfoACH*SOME POWER*412"), give a card spend's
// shop after the date ("spent using ICICI Bank Card XX1234 on 12-Nov-26 on SHOP."), and put a UPI or IMPS reference
// after a colon ("UPI:612300001111").

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, creditedParty, KnownBankParser, railParty, sharedParty } from "./known";

export class IciciParser extends KnownBankParser {
  readonly id = "icici";
  readonly bankName = "ICICI Bank";
  override readonly senderIds = ["ICICIB", "ICICIT"];
  override readonly packageNames = ["com.csam.icici.bank.imobile"];

  protected readonly shapes = [
    /^ICICI\s+Bank\s+Acc(?:t|ount)?\s+XX\d{3,4}\s+(?:is\s+)?(?:debited|credited)\b/i,
    /\bspent\s+using\s+ICICI\s+Bank\s+(?:\w+\s+)?Card\s+XX\d{4}\b/i,
    /\bdebited\s+from\s+ICICI\s+Bank\s+(?:\w+\s+)?Card\s+\d{4}\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    // "NEFT Transaction ... for Rs. 5000.00 has been credited to the beneficiary account": money the person sent.
    if (/\bcredited\s+to\s+the\s+beneficiary\s+account\b/i.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // The first account named is the person's own ("Acct XX123 debited ... & Acct XX456 credited").
    const acct = text.match(/\bAcc(?:t|ount)?\s+XX(\d{3,4})\b/i);
    if (acct) return { last4: acct[1], instrument: "account" };
    const card = text.match(/\bCard\s+(?:XX)?(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (this.atm(text)) return undefined;
    const card = text.match(/\bspent\s+using\s+ICICI\s+Bank\b.*?\bon\s+\S+\s+on\s+(.+?)\s*\.(?:\s|$)/i);
    const info = text.match(/\bInfo[\s:\-]*(.+?)(?:\.(?=\s|[A-Z]|$)|$)/);
    const towards = text.match(/\btowards\s+(.+?)\s+for\s+AutoPay\b/i);
    return (
      cleanParty(card?.[1]) ??
      creditedParty(text) ??
      railParty(info?.[1]) ??
      cleanParty(towards?.[1]) ??
      sharedParty(super.merchant(text, type))
    );
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\b(?:UPI|IMPS):\s*([A-Z0-9]{6,22})\b/i)?.[1] ?? super.ref(text);
  }
}
