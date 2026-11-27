// Canara Bank. A UPI alert writes the account with three or four masked digits and "Dr."/"credited with" ("Dear
// Customer, Acct XXX482 Dr. INR 317.40 on 04/11/26 to SHOP; UPI: <ref>; Bal INR ..."). A NEFT or RTGS credit names the
// account it reached ("has been credited to XXXX3917") and then the sender's own account ("Sender A/c XXXX5521"),
// which is never the person's.

import type { FoundAccount } from "../extract/account";
import { cleanParty, sharedParty, verbAccount } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

export class CanaraParser extends PublicSectorParser {
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
    // Money into a loan from the savings account ("credited to XXXX6610 … towards your Loan A/c from SB A/c XXXX3917"):
    // the person's account is the savings one; the loan's digits are never taken.
    if (/\bloan\b/i.test(text)) {
      const from = text.match(/\bfrom\s(?:SB\s)?A\/c\sX{2,8}(\d{4})\b/i);
      return from ? { last4: from[1], instrument: "account" } : null;
    }
    const reached = text.match(/\bhas\sbeen\s(?:credited|debited)\s(?:to|from)\sX{2,8}(\d{4})\b/i);
    if (reached) return { last4: reached[1], instrument: "account" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const party = text.match(/\b(?:by\sSender|to\sBeneficiary)\s([^,;.]{1,60}),/i);
    // A sender or beneficiary field is the only name such a message has: no guess when it holds no name.
    if (party) return nameOnly(party[1]);
    const name = nameOnly(sharedParty(super.merchant(text, type)));
    // "towards reversal of UPI txn", "refund from …, will be credited": a reason, never the other party.
    return name && !/^(?:reversal|refund|rev)\b/i.test(name) ? name : undefined;
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI:\s?(\d{12})\b/)?.[1] ?? super.ref(text);
  }
}
