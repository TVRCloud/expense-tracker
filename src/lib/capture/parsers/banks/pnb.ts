// Punjab National Bank and PNB credit cards. An account alert starts "Ac XX6731 Debited with Rs.…" or "A/c X6731
// debited INR … Dt … to NAME thru UPI:<ref>"; a card alert names the card with plain digits ("PNB Credit Card 4419
// debited with Rs.…"); a card used at an ATM reads "debited … thru card XX5108 … PNB ATM". A transfer names two
// accounts ("Your a/c no XX6731 is debited … and a/c XX5582 credited"): the person's is the one next to the verb.

import type { FoundAccount } from "../extract/account";
import { cleanParty, NAME, sharedParty, verbAccount } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

export class PnbParser extends PublicSectorParser {
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
    if (thru) return nameOnly(thru[1]);
    return shared && !/^(?:the\s)?bank\b|\bATM\b/i.test(shared) ? nameOnly(shared) : undefined;
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI(?:\sRef\sID)?:\s?(\d{12})\b/i)?.[1] ?? super.ref(text);
  }

  protected override atm(text: string): boolean {
    if (super.atm(text)) return true;
    // Cash taken "at PNB ATM" with the card; never a charge or fee at an ATM, a shop near one, or a reversal.
    if (/\b(?:charges?|fees?|enquiry|revers(?:al|ed)|not\sdispensed|refund)\b/i.test(text)) return false;
    // "at PNB ATM", "at SBI ATM": cash from an ATM; never "at non-PNB ATM" (a fee) or a shop "near" one.
    return /\bdebited\b[^]{0,80}?\bthru\scard\s[X*]{0,8}\d{4}\b[^]{0,40}?\bat\s(?!non-)(?:[A-Za-z]{2,12}\s)?ATM\b/i.test(text);
  }
}
