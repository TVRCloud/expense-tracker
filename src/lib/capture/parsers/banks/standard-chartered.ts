// Standard Chartered India. A transfer credit is written as a noun ("there is an NEFT credit of INR ... in your account
// 412xxxx5832"), which the shared direction rule does not read, and the account shows its first digits before the
// mask. A UPI debit names the payee's account only by its mask ("credited to a/c XX9046"), never the person's.

import { KnownBankParser, verbAccount } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";

const NOUN_MOVE = /\bthere\sis\san?\s(?:NEFT|RTGS|IMPS|UPI)\s(credit|debit)\sof\b/i;
const OWN_ACCOUNT = /\b(?:in|from)\syour\saccount\s\d{0,6}[x*]{2,8}(\d{4})\b/i;

export class StandardCharteredParser extends KnownBankParser {
  readonly id = "standard_chartered";
  readonly bankName = "Standard Chartered";
  override readonly senderIds = ["SCBANK"];

  protected readonly shapes = [
    /^Your\sa\/c\sXX\d{4}\sis\sdebited\sfor\sRs\.\s?[\d,.]{1,15}\son\s[\d/-]{6,10}\s\d{2}:\d{2}\sand\scredited\sto\sa\/c\sXX\d{4}\b/i,
    /^Dear\sCustomer,\sthere\sis\san?\s(?:NEFT|RTGS|IMPS|UPI)\s(?:credit|debit)\sof\sINR\s[\d,.]{1,15}\s(?:in|from)\syour\saccount\s\d{0,6}[x*]{2,8}\d{4}\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    const noun = text.match(NOUN_MOVE);
    if (noun) return { type: noun[1].toLowerCase() === "credit" ? "income" : "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const own = text.match(OWN_ACCOUNT);
    if (own) return { last4: own[1], instrument: "account" };
    // "Your a/c XX5832 is debited ... and credited to a/c XX9046": the account next to the verb of the money's direction.
    return verbAccount(text, type) ?? super.account(text, type);
  }
}
