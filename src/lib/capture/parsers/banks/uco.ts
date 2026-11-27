// UCO Bank. "A/c XX8840 Debited with Rs.475.00 on 04-11-2026 by UCO-UPI.Avl Bal …": the channel ("UCO-UPI") is never
// the other party, and these alerts name no payee.

import { KnownBankParser, sharedParty } from "./known";

export class UcoParser extends KnownBankParser {
  readonly id = "uco";
  readonly bankName = "UCO Bank";
  override readonly senderIds = ["UCOBNK"];

  protected readonly shapes = [/^A\/c\sXX\d{4}\s(?:Debited|Credited)\swith\sRs\.[\d,.]{1,15}\son\s/i];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const m = sharedParty(super.merchant(text, type));
    return m && !/^UCO-(?:UPI|IMPS|NEFT)\b/i.test(m) ? m : undefined;
  }
}
