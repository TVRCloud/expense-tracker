// Bandhan Bank. A UPI alert reads "INR … debited from A/c XXXXXXXXXX1234 towards UPI/DR/D<ref>/<payee> Value <date> .
// Clear Bal is INR …" (credits: "deposited to A/c … towards UPI/CR/C<ref>/<payer>/u on <date>"); interest reads
// "your account XXXX1234 is credited with INR … towards interest". Ticket 173.

import { KnownBankParser, sharedParty } from "./known";
import { upiPath } from "./small-finance-helpers";

export class BandhanParser extends KnownBankParser {
  readonly id = "bandhan";
  readonly bankName = "Bandhan Bank";
  override readonly senderIds = ["BDNSMS", "BANDHN"];

  protected readonly shapes = [
    /^INR\s[\d,.]{1,15}\s(?:debited\sfrom|deposited\sto)\sA\/c\sX{4,12}\d{4}\stowards\sUPI\/(?:DR|CR)\//i,
    /\byour\saccount\sX{4,12}\d{4}\sis\scredited\swith\sINR\s[\d,.]{1,15}\b/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const path = upiPath(text);
    if (path) return path.party;
    return sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return upiPath(text)?.ref ?? super.ref(text);
  }
}
