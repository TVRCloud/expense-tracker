// IDFC FIRST Bank. A UPI debit names the payee before "credited" ("debited by Rs. 1,172.06 on 12/11/26; SHOP
// credited."). Its "Happy Shopping!" card spend is read by formats.ts before this parser runs.

import { creditedParty, KnownBankParser, sharedParty } from "./known";

export class IdfcParser extends KnownBankParser {
  readonly id = "idfc";
  readonly bankName = "IDFC FIRST Bank";
  override readonly senderIds = ["IDFCFB", "IDFCBK"];
  override readonly packageNames = ["com.idfcfirstbank.optimus"];

  protected readonly shapes = [
    /^Your\s+A\/C\s+X+\d{4}\s+is\s+(?:debited|credited)\s+by\s+INR\b/i,
    /^Your\s+A\/c\s+XX\d{4}\s+debited\s+by\s+Rs\.?/i,
    /\bspent\s+on\s+your\s+IDFC\s+FIRST\s+Bank\s+Credit\s+Card\s+ending\s+XX\d{4}\b/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    return creditedParty(text) ?? sharedParty(super.merchant(text, type));
  }
}
