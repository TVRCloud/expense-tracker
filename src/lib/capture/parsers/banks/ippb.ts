// India Post Payments Bank. A debit is written "A/C X1234 Debit Rs. … for UPI to <UPI id>" ("Debit" before the
// amount, which the shared direction rule does not read), a credit "You have received a payment of Rs. … in a/c
// X1234 … from <name> thru IPPB" (the shared rule sees "payment of" as a debit word too). Ticket 173.

import type { FoundDirection } from "../extract/direction";
import { cleanParty, KnownBankParser, NAME, sharedParty, vpaAfter } from "./known";

const DEBIT = /^A\/C\sX\d{4}\sDebit\s(?:Rs\.?|INR)\s?\d/i;
const RECEIVED = /\breceived\sa\spayment\sof\s(?:Rs\.?|INR)\s?\d/i;

export class IppbParser extends KnownBankParser {
  readonly id = "ippb";
  readonly bankName = "India Post Payments Bank";
  override readonly senderIds = ["IPBMSG"];

  protected readonly shapes = [DEBIT, /\breceived\sa\spayment\sof\sRs\.?\s?[\d,.]{1,15}\sin\sa\/c\sX\d{4}\b/i];

  protected override direction(text: string): FoundDirection | null {
    if (DEBIT.test(text)) return { type: "expense", ambiguous: false };
    if (RECEIVED.test(text)) return { type: "income", ambiguous: false };
    return super.direction(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (type === "income") {
      const thru = text.match(new RegExp(String.raw`\bfrom\s${NAME}\sthru\sIPPB\b`, "i"));
      if (thru) return cleanParty(thru[1]);
    }
    return vpaAfter(type === "expense" ? "to" : "from", text) ?? sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bInfo:\s?UPI\/(?:CREDIT|DEBIT)\/(\d{6,22})\b/i)?.[1] ?? super.ref(text);
  }
}
