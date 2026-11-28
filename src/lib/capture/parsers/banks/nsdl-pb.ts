// NSDL Payments Bank. A UPI debit reads "A/c XX1234 debited Rs … for linked <UPI id>" or, through a linked wallet,
// "for linked <bank> PPI A/c XX9999 to <UPI id>": the payee is the UPI id after "linked" or after "to". Ticket 173.

import { sharedParty, vpaAfter } from "./known";
import { cleanVpa, SmallFinanceParser } from "./small-finance-helpers";

const LINKED_VPA = /\bfor\slinked\s([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i;

export class NsdlPbParser extends SmallFinanceParser {
  readonly id = "nsdl_pb";
  readonly bankName = "NSDL Payments Bank";
  override readonly senderIds = ["NSDLPB"];

  protected readonly shapes = [/^A\/c\s(?:no\s)?XX\d{4}\s(?:debited\sRs\.?|is\scredited\sfor\sRs\.?)\s?[\d,.]{1,15}\b/i];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (type === "expense") {
      const linked = cleanVpa(text.match(LINKED_VPA)?.[1]);
      if (linked) return linked;
      // "for linked <bank> PPI A/c XX9999 to <UPI id>": the payee is after "to", never the wallet account.
      const to = cleanVpa(vpaAfter("to", text));
      if (to) return to;
    }
    return sharedParty(super.merchant(text, type));
  }
}
