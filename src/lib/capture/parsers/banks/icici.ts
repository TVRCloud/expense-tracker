// ICICI Bank. An account is masked to three digits ("Acct XX274"); a UPI payee comes before "credited" ("...;
// LAKESIDE BAKERY credited."); a NACH, NEFT or bill payee follows "Info" ("InfoACH*SOME POWER*437"); a card spend
// gives the shop after the date ("spent using ICICI Bank Card XX3391 on 03-Oct-26 on SHOP."); a UPI or IMPS
// reference follows a colon ("UPI:604400118822").

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, creditedParty, KnownBankParser, NAME, railParty, sharedParty } from "./known";

export class IciciParser extends KnownBankParser {
  readonly id = "icici";
  readonly bankName = "ICICI Bank";
  override readonly senderIds = ["ICICIB", "ICICIT"];
  override readonly packageNames = ["com.csam.icici.bank.imobile"];

  protected readonly shapes = [
    /^ICICI\sBank\sAcc(?:t|ount)?\sXX\d{3,4}\s(?:is\s)?(?:debited|credited)\b/i,
    /\bspent\susing\sICICI\sBank\s(?:\w{1,12}\s)?Card\sXX\d{4}\b/i,
    /\bdebited\sfrom\sICICI\sBank\s(?:\w{1,12}\s)?Card\s\d{4}\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    // "NEFT Transaction ... has been credited to the beneficiary account": money the person sent.
    if (/\bcredited\sto\sthe\sbeneficiary\saccount\b/i.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // The first account named is the person's own ("Acct XX274 debited ... & Acct XX653 credited"). Three digits do
    // not match a saved four-digit account; see the account-match note in src/lib/CLAUDE.md.
    const acct = text.match(/(?<!\bloan\s)\bAcc(?:t|ount)?\sXX(\d{3,4})\b/i); // a loan account is never the person's own
    if (acct) return { last4: acct[1], instrument: "account" };
    const card = text.match(/\bCard\s(?:XX)?(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override atm(text: string): boolean {
    return super.atm(text) || /\bInfo\s?ATM\*/i.test(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (this.atm(text)) return undefined;
    const card = text.match(new RegExp(String.raw`\bspent\susing\sICICI\sBank\b[^.]{0,60}?\bon\s\S{1,12}\son\s${NAME}\s?\.(?:\s|$)`, "i"));
    const info = text.match(/\bInfo[\s:\-]{0,3}([^.]{1,80}?)(?:\.(?=\s|[A-Z]|$)|$)/);
    const towards = text.match(new RegExp(String.raw`\btowards\s${NAME}\sfor\sAutoPay\b`, "i"));
    return (
      cleanParty(card?.[1]) ??
      creditedParty(text) ??
      railParty(info?.[1]) ??
      cleanParty(towards?.[1]) ??
      sharedParty(super.merchant(text, type))
    );
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\b(?:UPI|IMPS):\s?([A-Z0-9]{6,22})\b/i)?.[1] ?? super.ref(text);
  }
}
