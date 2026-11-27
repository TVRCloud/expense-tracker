// HDFC Bank. A card alert names the card by four plain digits and the shop after "At" ("Spent Rs.93.00 On HDFC Bank
// Card 5150 At ..PINE CORNER On 2026-10-03:..."); a NEFT credit carries the payer inside "NEFT Cr-<IFSC>-<NAME>-...";
// a NetBanking payment starts "Payment Successful!" and has no debit word.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, KnownBankParser, NAME, sharedParty } from "./known";

// "... from A/c ****5150 to <payee> via HDFC Bank NetBanking"
const NETBANKING_PAYEE = new RegExp(String.raw`\bA\/c\s[*xX]{0,8}\d{4}\sto\s${NAME}\svia\sHDFC Bank NetBanking\b`, "i");

export class HdfcParser extends KnownBankParser {
  readonly id = "hdfc";
  readonly bankName = "HDFC Bank";
  override readonly senderIds = ["HDFCBK"];
  override readonly packageNames = ["com.snapwork.hdfc"];

  protected readonly shapes = [
    /^Spent\sRs\.?\s?[\d,.]{1,15}\sOn\sHDFC\sBank\sCard\s[x*]{0,4}\d{4}\sAt\s/i,
    /^Sent\sRs\.?\s?[\d,.]{1,15}\sFrom\sHDFC\sBank\sA\/C\s[x*]{0,8}\d{4}\sTo\s/i,
    /\bdeposited\sin\sHDFC\sBank\sA\/c\s[x*]{1,8}\d{4}\b/i,
    /\bcredited\sto\sHDFC\sBank\sA\/c\s[x*]{1,8}\d{4}\b/i,
    /^Transaction\sReversed!\s?On\sHDFC\sBank\s/i,
    /^Payment\sSuccessful!\sRs\.?\s?[\d,.]{1,15}\sfrom\sA\/c\s[*xX]{0,8}\d{4}\sto\s/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    const shared = super.direction(text);
    if (shared) return shared;
    return /^Payment\sSuccessful!/i.test(text) && /\bfrom\sA\/c\b/i.test(text) ? { type: "expense", ambiguous: false } : null;
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const shared = super.account(text, type);
    if (shared) return shared;
    const card = text.match(/\bHDFC\sBank\s(?:credit\s|debit\s)?card\s[x*]{0,4}(\d{4})\b/i);
    return card ? { last4: card[1], instrument: "card" } : null;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const patterns = [
      new RegExp(String.raw`^Spent\b(?:[^.]|\.(?=\d)){0,80}?\bAt\s\.{0,4}${NAME}\sOn\s\d`, "i"), // card spend
      new RegExp(String.raw`\bReversed!(?:[^.]|\.(?=\d)){0,80}?\bBy\s${NAME}\sOn\s\d`, "i"), // card reversal
      /\bNEFT\s?Cr-[A-Z0-9]{1,20}-([^-.]{2,60})/i, // NEFT credit
      NETBANKING_PAYEE,
    ];
    for (const re of patterns) {
      const party = cleanParty(text.match(re)?.[1]);
      if (party) return party;
    }
    return sharedParty(super.merchant(text, type));
  }
}
