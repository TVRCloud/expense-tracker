// IDFC FIRST Bank. A UPI debit names the payee before "credited" ("debited by Rs. 312.40 on 03/10/26; SHOP
// credited."). Its "Happy Shopping!" card spend is read by formats.ts before this parser runs.

import { creditedParty, KnownBankParser, sharedParty } from "./known";

export class IdfcParser extends KnownBankParser {
  readonly id = "idfc";
  readonly bankName = "IDFC FIRST Bank";
  override readonly senderIds = ["IDFCFB", "IDFCBK"];
  override readonly packageNames = ["com.idfcfirstbank.optimus"];

  protected readonly shapes = [
    /^Your\sA\/C\sX{1,10}\d{4}\sis\s(?:debited|credited)\sby\sINR\b/i,
    /^Your\sA\/c\sXX\d{4}\sdebited\sby\sRs\.?/i,
    /\bspent\son\syour\sIDFC\sFIRST\sBank\sCredit\sCard\sending\sXX\d{4}\b/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    return creditedParty(text) ?? sharedParty(super.merchant(text, type));
  }
}
