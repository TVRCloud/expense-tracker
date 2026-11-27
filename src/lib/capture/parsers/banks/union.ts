// Union Bank of India. The account is "A/c*5093" or "A/c *5093"; the amount may follow a colon ("Rs:740.00"); a mobile
// banking alert names the payee after the transfer number ("by MB 6601234567 NAVKAR MEDICALS, Bal Rs…").

import type { FoundAmount } from "../extract/amount";
import type { FoundAccount } from "../extract/account";
import type { FoundFigure } from "../extract/balance";
import { cleanParty, sharedParty, verbAccount } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

/** "Rs:740.00" reads as "Rs 740.00" (same length, so positions do not move). */
const plainRupees = (text: string) => text.replace(/\bRs:/gi, "Rs ");

export class UnionParser extends PublicSectorParser {
  readonly id = "union";
  readonly bankName = "Union Bank of India";
  override readonly senderIds = ["UNIONB"];

  protected readonly shapes = [
    /^Union\sBank\sof\sIndia\sA\/c\s?\*\d{4}\s(?:Dr|Cr)\sRs\s?[\d,.]{1,15}\son\s/i,
    /^A\/c\s?\*\d{4}\s(?:Debited|Credited)\sfor\sRs:[\d,.]{1,15}\son\s/i,
  ];

  protected override amount(text: string): FoundAmount | null {
    return super.amount(plainRupees(text));
  }

  protected override balance(text: string): FoundFigure | undefined {
    return super.balance(plainRupees(text));
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Two accounts in one message: the one next to the verb that matches the direction (ticket 156).
    const moved = verbAccount(text, type);
    if (moved) return moved;
    const acct = text.match(/(?<!\b(?:loan|card)\s)\bA\/c\s?\*(\d{4})\b/i);
    return acct ? { last4: acct[1], instrument: "account" } : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const mb = text.match(/\bby\sMB\s\d{6,12}\s(\S[^,.;]{0,58}?),/i);
    // A phone or account number after the name is never part of it ("RAVI 9812345678").
    if (mb) return nameOnly(mb[1]);
    if (/\bby\sMob\sBk\b/i.test(text)) return undefined;
    return sharedParty(super.merchant(plainRupees(text), type));
  }

  protected override ref(text: string): string | undefined {
    // The number after "by MB" may be a phone number: never kept as a reference.
    if (/\bby\sMB\s\d/i.test(text)) return undefined;
    return text.match(/\bref\sno\s(\d{6,16})\b/i)?.[1] ?? super.ref(text);
  }
}
