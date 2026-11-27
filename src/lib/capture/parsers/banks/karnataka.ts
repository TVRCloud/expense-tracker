// Karnataka Bank. A UPI debit reads "Your a/c XX1234 debited for Rs.X on <date> trf to NAME. UPI:<masked ref>"; the
// shared rules read it, this parser only adds the bank's name and shape.

import { KnownBankParser } from "./known";

export class KarnatakaParser extends KnownBankParser {
  readonly id = "karnataka";
  readonly bankName = "Karnataka Bank";
  override readonly senderIds = ["KBLBNK"];

  protected readonly shapes = [/^Your\sa\/c\sXX\d{4}\s(?:debited|credited)\sfor\sRs\.?\s?[\d,.]{1,15}\son\s\S{1,12}\s(?:trf\sto|from)\s/i];
}
