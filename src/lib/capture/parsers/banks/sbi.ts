// State Bank of India and SBI Card. Some alerts are written in styled Unicode letters (mathematical bold), which read
// as plain text once NFKC-normalised; an account is written glued to its mask ("A/cX1234"); a debit card spend says
// "by SBI Debit Card 1234 done at SHOP on 12Nov26" with no debit word.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { ignoreReason } from "../ignore";
import type { MoneyParse } from "../types";
import { cleanParty, KnownBankParser, sharedParty } from "./known";

export class SbiParser extends KnownBankParser {
  readonly id = "sbi";
  readonly bankName = "SBI";
  override readonly senderIds = ["SBIINB", "SBIUPI", "ATMSBI", "CBSSBI", "SBICRD", "SBIBNK"];
  override readonly packageNames = ["com.sbi.lotusintouch", "com.sbi.sbifreedomplus"];

  protected readonly shapes = [
    /\bby\s+SBI\s+(?:Debit|Credit)\s+Card\s+[x*]*\d{4}\s+done\s+at\s/i,
    /\bspent\s+on\s+your\s+SBI\s+Credit\s+Card\s+ending(?:\s+with)?\s+\d{4}\b/i,
    /\bA\/c\s*X+\d{4}\s+(?:debited|credited)\s+by\b/i,
  ];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const plain = text.normalize("NFKC");
    // The ignore checks ran on the styled text; run them again on what it says.
    if (plain !== text && ignoreReason(plain)) return null;
    return super.parse(plain, receivedAt);
  }

  protected override direction(text: string): FoundDirection | null {
    return super.direction(text) ?? (/\bdone\s+at\b/i.test(text) ? { type: "expense", ambiguous: false } : null);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const glued = text.match(/\bA\/c\s*[X*]+(\d{4})\b/i);
    if (glued) return { last4: glued[1], instrument: "account" };
    const card = text.match(/\b(?:Debit|Credit)\s+Card\s+(?:ending\s+(?:with\s+)?)?[x*]*(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const doneAt = text.match(/\bdone\s+at\s+(.+?)\s+on\s+\d/i);
    const fromTransfer = text.match(/\btransfer\s+from\s+(.+?)(?:\s+Ref|\s*\(|\.(?:\s|$)|$)/i);
    return cleanParty(doneAt?.[1]) ?? cleanParty(fromTransfer?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
