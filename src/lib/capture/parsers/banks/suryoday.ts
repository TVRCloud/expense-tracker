// Suryoday Small Finance Bank credit card. A spend reads "Rs … spent on [<card name>] Suryoday SFB CC 1234 on <date>
// at <time>. Avlb Rs …": the card's last four follow "CC", the available limit follows "Avlb", and no shop is printed
// (the "to 9000…" in its help line is a phone number, never a payee). Ticket 173.

import type { FoundAccount } from "../extract/account";
import type { FoundFigure } from "../extract/balance";
import { toMinorUnits } from "../extract/amount";
import { KnownBankParser } from "./known";

const CARD = /\bSuryoday\sSFB\sCC\s(\d{4})\b/i;
const AVAILABLE = /\bAvlb\.?\s(?:Rs\.?|INR)\s?(\d{1,3}(?:,\d{2,3}){0,5}(?:\.\d{1,2})?|\d{1,13}(?:\.\d{1,2})?)(?![\d,])/i;

export class SuryodayParser extends KnownBankParser {
  readonly id = "suryoday";
  readonly bankName = "Suryoday Small Finance Bank";
  override readonly senderIds = ["SSFBNK"];

  protected readonly shapes = [/^(?:Rs\.?|INR)\s?[\d,.]{1,15}\sspent\son\s(?:[A-Za-z]{1,20}\s){0,3}Suryoday\sSFB\sCC\s\d{4}\b/i];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const card = text.match(CARD);
    return card ? { last4: card[1], instrument: "card" } : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    // Its spend alerts name no shop; anything the shared reader finds is the help line.
    return CARD.test(text) ? undefined : super.merchant(text, type);
  }

  protected override availableLimit(text: string): FoundFigure | undefined {
    const m = text.match(AVAILABLE);
    if (!m) return super.availableLimit(text);
    const minor = toMinorUnits(m[1]);
    return Number.isSafeInteger(minor) && minor > 0 && minor < 1e13 ? { minor } : undefined;
  }
}
