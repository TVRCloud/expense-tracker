// South Indian Bank. The direction comes before a colon with no verb ("UPI debit:Rs.X A/c X1234, <date> RRN: <ref>",
// "A/c X1234 DEBIT:Rs.X SHOP MCT Bal:Rs.Y", "UPI Credit:INR Rs.X in A/c X1234"); the other party sits in an
// "Info: <rail>/<bank code>/<ref>/ NAME" field.

import type { FoundDirection } from "../extract/direction";
import { cleanParty, KnownBankParser, sharedParty } from "./known";

const DEBIT_COLON = /\b(?:UPI\s)?debit:\s?(?:INR\s)?Rs\.?\s?\d/i;
const CREDIT_COLON = /\b(?:UPI\s)?credit:\s?(?:INR\s)?Rs\.?\s?\d/i;

export class SouthIndianParser extends KnownBankParser {
  readonly id = "south_indian";
  readonly bankName = "South Indian Bank";
  override readonly senderIds = ["SIBSMS"];

  protected readonly shapes = [
    /^UPI\s(?:debit|Credit):\s?(?:INR\s)?Rs\.?\s?[\d,.]{1,15},?\s(?:in\s)?A\/c\sX\d{4}\b/i,
    /^A\/c\sX\d{4}\sDEBIT:\s?Rs\.?\s?[\d,.]{1,15}\s/i,
    /\bYour\sA\/c\sX\d{4}\sis\scredited\swith\sRs\.?\s?[\d,.]{1,15}\sInfo:\s?(?:IMPS|NEFT|UPI)\//i,
  ];

  protected override direction(text: string): FoundDirection | null {
    const shared = super.direction(text);
    if (shared) return shared;
    const debit = DEBIT_COLON.test(text);
    const credit = CREDIT_COLON.test(text);
    if (debit === credit) return null;
    return { type: debit ? "expense" : "income", ambiguous: false };
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const shop = text.match(/\bDEBIT:\s?Rs\.?\s?[\d,]{1,15}(?:\.\d{1,2})?\s(\S[^.;:]{0,58}?)\s(?:MCT\s)?Bal:/i);
    const info = text.match(/\bInfo:\s?(?:UPI|IMPS|NEFT)\/[A-Za-z]{3,5}\/\d{6,22}\/\s?(\S[^/;]{0,58}?)(?:\son\s\d|\.\s|\.$|$)/i);
    return cleanParty(shop?.[1]) ?? cleanParty(info?.[1]) ?? sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bInfo:\s?(?:UPI|IMPS|NEFT)\/[A-Za-z]{3,5}\/(\d{6,22})\//i)?.[1] ?? super.ref(text);
  }
}
