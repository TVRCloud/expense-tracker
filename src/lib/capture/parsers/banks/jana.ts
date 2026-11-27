// Jana Small Finance Bank. "Your acct XX318 is debited with INR … to <UPI id>" / "is credited with INR … from <name>":
// the account is masked to three digits, which the shared reader (it needs four) does not see. Three digits never
// match a saved four-digit account, so account matching falls back to the bank guess (see src/lib/CLAUDE.md, the
// same as ICICI). Ticket 173.

import type { FoundAccount } from "../extract/account";
import { KnownBankParser } from "./known";

const ACCT = /(?<!\b(?:loan|card)\s)\bacct\sXX(\d{3,4})\sis\s(debited|credited)\b/i;

export class JanaParser extends KnownBankParser {
  readonly id = "jana";
  readonly bankName = "Jana Small Finance Bank";
  override readonly senderIds = ["JANABK"];

  protected readonly shapes = [/\bYour\sacct\sXX\d{3,4}\sis\s(?:debited|credited)\swith\sINR\s[\d,.]{1,15}\b/i];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const m = text.match(ACCT);
    // Only the account named with the verb that matches the money's direction.
    if (m && (m[2].toLowerCase() === "debited") === (type === "expense")) return { last4: m[1], instrument: "account" };
    return super.account(text, type);
  }
}
