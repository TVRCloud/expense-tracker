// State Bank of India and SBI Card. An account is written glued to its mask ("A/cX7731"); a debit card spend says
// "by SBI Debit Card 7731 done at SHOP on 03Oct26" with no debit word. Styled Unicode letters are made plain for
// every sender in createCaptureParser.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, KnownBankParser, NAME, sharedParty } from "./known";

// Only the card-spend shapes read "done at" as a debit, never a deposit or a credit: "by SBI Debit Card 1234 done at
// SHOP" and "done at SHOP on your SBI Credit Card ending 1234".
const CARD_DONE_AT =
  /\bby\sSBI\s(?:Debit|Credit)\sCard\s[x*]{0,4}\d{4}\sdone\sat\s|\bdone\sat\s[^.]{1,60}?\son\syour\sSBI\s(?:Debit|Credit)\sCard\sending\s/i;
const MONEY_IN = /\b(?:deposit(?:ed)?|credited|refund(?:ed)?|revers(?:al|ed))\b/i;

export class SbiParser extends KnownBankParser {
  readonly id = "sbi";
  readonly bankName = "SBI";
  override readonly senderIds = ["SBIINB", "SBIUPI", "ATMSBI", "CBSSBI", "SBICRD"];
  override readonly packageNames = ["com.sbi.lotusintouch", "com.sbi.sbifreedomplus"];

  protected readonly shapes = [
    CARD_DONE_AT,
    /\bspent\son\syour\sSBI\sCredit\sCard\sending(?:\swith)?\s\d{4}\b/i,
    /\bA\/c\s?X{1,8}\d{4}\s(?:debited|credited)\sby\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    const shared = super.direction(text);
    if (shared) return shared;
    return CARD_DONE_AT.test(text) && !MONEY_IN.test(text) ? { type: "expense", ambiguous: false } : null;
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const glued = text.match(/\bA\/c\s?[X*]{1,8}(\d{4})\b/i);
    if (glued) return { last4: glued[1], instrument: "account" };
    const card = text.match(/\b(?:Debit|Credit)\sCard\s(?:ending\s(?:with\s)?)?[x*]{0,8}(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const doneAt = CARD_DONE_AT.test(text) ? text.match(new RegExp(String.raw`\bdone\sat\s${NAME}\s(?:on|has|is)\b`, "i")) : null;
    const fromTransfer = text.match(new RegExp(String.raw`\btransfer\sfrom\s${NAME}(?:\sRef|\s?\(|\.(?:\s|$)|$)`, "i"));
    return cleanParty(doneAt?.[1]) ?? cleanParty(fromTransfer?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
