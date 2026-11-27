// Airtel Payments Bank. Its alerts name no account digits ("Airtel Payments Bank a/c is credited with Rs. …",
// "Rs. … debited from Airtel Payments Bank a/c Txn ID …"), so a read never earns the account's share of the score and
// goes to Review, where the person picks the account; nothing is guessed. Digits of another party's account ("to RAVI
// KUMAR A/c XX9911", "from a/c XX9911") are never taken as the person's. Ticket 173.

import type { FoundAccount } from "../extract/account";
import { KnownBankParser } from "./known";

// Only digits printed as the person's own Airtel Payments Bank account; another party's "A/c XX9911" never is.
const OWN = /\bAirtel\sPayments\sBank\sa\/c\s(?:no\.?\s)?[x*]{0,8}(\d{4})\b/i;

export class AirtelPbParser extends KnownBankParser {
  readonly id = "airtel_pb";
  readonly bankName = "Airtel Payments Bank";
  override readonly senderIds = ["AIRBNK"];

  protected readonly shapes = [
    /^Airtel\sPayments\sBank\sa\/c\sis\scredited\swith\sRs\.?\s?[\d,.]{1,15}\b/i,
    /^Rs\.?\s?[\d,.]{1,15}\sdebited\sfrom\sAirtel\sPayments\sBank\sa\/c\b/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // A message in the bank's own wording: only digits printed as its own account, never another party's.
    if (/\bAirtel\sPayments\sBank\sa\/c\b/i.test(text)) {
      const m = text.match(OWN);
      return m ? { last4: m[1], instrument: "account" } : null;
    }
    return super.account(text, type);
  }
}
