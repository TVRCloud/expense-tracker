// Jio Payments Bank. "Your JPB A/c x1234 is debited with Rs. … UPI/DR/<ref>/<payee>." (credits "credited with",
// "UPI/CR/…"), and a send "Rs. … Sent from x1234 to <UPI id>". The account is masked with a single "x", which the
// shared reader does not take after "from". Ticket 173.

import type { FoundAccount } from "../extract/account";
import { KnownBankParser, sharedParty } from "./known";
import { upiPath } from "./small-finance-helpers";

const OWN = /(?<!\b(?:loan|card)\s)\b(?:JPB\sA\/c\s|Sent\sfrom\s)x(\d{4})\b/i;

export class JioPbParser extends KnownBankParser {
  readonly id = "jio_pb";
  readonly bankName = "Jio Payments Bank";
  override readonly senderIds = ["JIOPBS"];

  protected readonly shapes = [
    /\bJPB\sA\/c\sx\d{4}\sis\s(?:debited|credited)\swith\sRs\.?\s?[\d,.]{1,15}\b/i,
    /^Rs\.?\s?[\d,.]{1,15}\sSent\sfrom\sx\d{4}\sto\s/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const m = text.match(OWN);
    return m ? { last4: m[1], instrument: "account" } : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const path = upiPath(text);
    if (path) return path.party;
    return sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return upiPath(text)?.ref ?? super.ref(text);
  }
}
