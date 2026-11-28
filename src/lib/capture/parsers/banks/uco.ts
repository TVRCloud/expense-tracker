// UCO Bank. "A/c XX8840 Debited with Rs.475.00 on 04-11-2026 by UCO-UPI.Avl Bal …": the channel ("UCO-UPI") is never
// the other party, and these alerts name no payee.

import { cleanParty, sharedParty } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

export class UcoParser extends PublicSectorParser {
  readonly id = "uco";
  readonly bankName = "UCO Bank";
  override readonly senderIds = ["UCOBNK"];

  protected readonly shapes = [/^A\/c\sXX\d{4}\s(?:Debited|Credited)\swith\sRs\.[\d,.]{1,15}\son\s/i];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    // The channel ("UCO-UPI", "UCO-IMPS") is never the payee; a name after it is kept ("UCO-IMPS SHOPKART" is "SHOPKART").
    const m = sharedParty(super.merchant(text, type));
    return nameOnly(m?.replace(/^UCO-(?:UPI|IMPS|NEFT)\b[\s/-]*/i, ""));
  }
}
