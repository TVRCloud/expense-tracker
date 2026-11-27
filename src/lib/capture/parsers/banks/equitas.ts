// Equitas Small Finance Bank. The account is written with its plain last four digits after the bank's name
// ("from Equitas A/c 7302", "from Equitas-7302"), which the shared reader (it needs a mask) does not see. The payee
// follows "to" and the payer "from"; the shared reader finds both. Ticket 173.

import type { FoundAccount } from "../extract/account";
import { KnownBankParser } from "./known";
import { plainAccount } from "./small-finance-helpers";

export class EquitasParser extends KnownBankParser {
  readonly id = "equitas";
  readonly bankName = "Equitas Small Finance Bank";
  override readonly senderIds = ["EQUTAS", "EQUITA"];

  protected readonly shapes = [
    /^INR\s[\d,.]{1,15}\s(?:debited\svia\sUPI\sfrom|credited\svia\sUPI\sto)\sEquitas\sA\/c\s\d{4}\b/i,
    /^INR\s[\d,.]{1,15}\sdebited\sfrom\sEquitas-\d{4}\svia\sUPI\b/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    return plainAccount(text, "Equitas") ?? super.account(text, type);
  }
}
