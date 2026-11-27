// HDFC Bank. Its card alerts name the card by four plain digits ("On HDFC Bank Card 4321 At ..SHOP On 2026-11-12:...")
// and the shop after "At"; a NEFT credit carries the payer inside "NEFT Cr-<IFSC>-<NAME>-..."; a NetBanking payment
// says "Payment Successful! ... from A/c ... to <payee> via HDFC Bank NetBanking" with no debit word.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, KnownBankParser, sharedParty } from "./known";

export class HdfcParser extends KnownBankParser {
  readonly id = "hdfc";
  readonly bankName = "HDFC Bank";
  override readonly senderIds = ["HDFCBK"];
  override readonly packageNames = ["com.snapwork.hdfc"];

  protected readonly shapes = [
    /^Spent\s+Rs\.?\s*[\d,.]+\s+On\s+HDFC\s+Bank\s+Card\s+[x*]*\d{4}\s+At\s/i,
    /^Sent\s+Rs\.?\s*[\d,.]+\s+From\s+HDFC\s+Bank\s+A\/C\s+[x*]*\d{4}\s+To\s/i,
    /\bdeposited\s+in\s+HDFC\s+Bank\s+A\/c\s+[x*]+\d{4}\b/i,
    /\bcredited\s+to\s+HDFC\s+Bank\s+A\/c\s+[x*]+\d{4}\b/i,
    /^Transaction\s+Reversed!\s*On\s+HDFC\s+Bank\s/i,
    /^Payment\s+Successful!.*\bvia\s+HDFC\s+Bank\s+NetBanking\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    // "Refund initiated: ... To receive your Refund, please update your Bank details": money still to come. Not read
    // here, so the generic parser's low score keeps it in Review.
    if (/\brefund\s+initiated\b/i.test(text)) return null;
    const shared = super.direction(text);
    if (shared) return shared;
    // "Payment Successful! Rs. 2,400.00 from A/c ****4321 to SOME BILLER via HDFC Bank NetBanking"
    return /\bpayment\s+successful\b/i.test(text) && /\bfrom\s+a\/c\b/i.test(text) ? { type: "expense", ambiguous: false } : null;
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const shared = super.account(text, type);
    if (shared) return shared;
    const card = text.match(/\bHDFC\s+Bank\s+(?:credit\s+|debit\s+)?card\s+[x*]*(\d{4})\b/i);
    return card ? { last4: card[1], instrument: "card" } : null;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const patterns = [
      /^Spent\b.*?\bAt\s+(.+?)\s+On\s+\d/i, // card spend
      /\bReversed!.*?\bBy\s+(.+?)\s+On\s+\d/i, // card reversal
      /\bNEFT\s*Cr-[A-Z0-9]+-([^-.]+?)(?:-|\.|$)/i, // NEFT credit
      /\bto\s+(.+?)\s+via\s+HDFC\s+Bank\s+NetBanking\b/i,
    ];
    for (const re of patterns) {
      const party = cleanParty(text.match(re)?.[1]);
      if (party) return party;
    }
    return sharedParty(super.merchant(text, type));
  }
}
