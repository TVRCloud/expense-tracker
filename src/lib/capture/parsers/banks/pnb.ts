// Punjab National Bank and PNB credit cards. An account alert starts "Ac XX6731 Debited with Rs.…" or "A/c X6731
// debited INR … Dt … to NAME thru UPI:<ref>"; a card alert names the card with plain digits ("PNB Credit Card 4419
// debited with Rs.…"); a card used at an ATM reads "debited … thru card XX5108 … PNB ATM". A transfer names two
// accounts ("Your a/c no XX6731 is debited … and a/c XX5582 credited"): the person's is the one next to the verb.

import type { FoundAccount } from "../extract/account";
import { cleanParty, KnownBankParser, NAME, sharedParty, verbAccount } from "./known";

export class PnbParser extends KnownBankParser {
  readonly id = "pnb";
  readonly bankName = "Punjab National Bank";
  override readonly senderIds = ["PNBSMS", "PNBBNK", "PNBCCD"];

  protected readonly shapes = [
    /^A\/?c\sX{1,8}\d{4}\s(?:Debited|Credited)\swith\sRs\./i,
    /^A\/c\sX{1,8}\d{4}\sdebited\sINR\s[\d,.]{1,15}\sDt\s/i,
    /^PNB\sCredit\sCard\s\d{4}\sdebited\swith\sRs\./i,
    /^Your\sa\/c\sno\sX{1,8}\d{3,4}\sis\sdebited\sfor\sRs\s[\d,.]{1,15}\son\s/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const moved = verbAccount(text, type);
    if (moved) return moved;
    const card = text.match(/\bPNB\sCredit\sCard\s(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    const acct = text.match(/(?<!\b(?:loan|card)\s)\bA\/?c\s(?:no\s)?X{1,12}(\d{4})\b/i);
    if (acct) return { last4: acct[1], instrument: "account" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const thru = text.match(new RegExp(String.raw`\bto\s${NAME}\sthru\sUPI\b`, "i"));
    const shared = sharedParty(super.merchant(text, type));
    // A help line ("Report it to the bank", "forward this SMS to report") is never the payee.
    return cleanParty(thru?.[1]) ?? (shared && !/^(?:the\s)?bank\b/i.test(shared) ? shared : undefined);
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI(?:\sRef\sID)?:\s?(\d{12})\b/i)?.[1] ?? super.ref(text);
  }

  protected override atm(text: string): boolean {
    return super.atm(text) || /\bdebited\b[^]{0,80}?\bthru\scard\s[X*]{0,8}\d{4}\b[^]{0,120}?\bPNB\sATM\b/i.test(text);
  }
}
