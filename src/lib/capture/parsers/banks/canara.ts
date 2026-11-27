// Canara Bank. A UPI alert writes the account with three or four masked digits and "Dr."/"credited with" ("Dear
// Customer, Acct XXX482 Dr. INR 317.40 on 04/11/26 to SHOP; UPI: <ref>; Bal INR ..."). A NEFT or RTGS credit names the
// account it reached ("has been credited to XXXX3917") and then the sender's own account ("Sender A/c XXXX5521"),
// which is never the person's.

import type { FoundAccount } from "../extract/account";
import { cleanParty, KnownBankParser, sharedParty, verbAccount } from "./known";

export class CanaraParser extends KnownBankParser {
  readonly id = "canara";
  readonly bankName = "Canara Bank";
  override readonly senderIds = ["CANBNK", "CANARA"];

  protected readonly shapes = [
    /^Dear\sCustomer,\sAcct\sX{2,4}\d{3,4}\s(?:Dr\.|credited\swith)\s(?:INR|Rs\.?|₹)/i,
    /^An\samount\sof\sINR\s[\d,.]{1,15}\shas\sbeen\s(?:credited|debited)\s(?:to|from)\sX{2,8}\d{4}\b/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Two accounts in one message: the one next to the verb that matches the direction (ticket 156).
    const moved = verbAccount(text, type);
    if (moved) return moved;
    const acct = text.match(/(?<!\b(?:loan|card)\s)\bAcct\sX{2,4}(\d{3,4})\b/i);
    if (acct) return { last4: acct[1], instrument: "account" };
    const reached = text.match(/\bhas\sbeen\s(?:credited|debited)\s(?:to|from)\sX{2,8}(\d{4})\b/i);
    if (reached) return { last4: reached[1], instrument: "account" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const sender = text.match(/\bby\sSender\s([^,;.]{1,60}),/i);
    return cleanParty(sender?.[1]) ?? sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI:\s?(\d{12})\b/)?.[1] ?? super.ref(text);
  }
}
