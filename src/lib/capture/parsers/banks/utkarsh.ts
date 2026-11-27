// Utkarsh Small Finance Bank SuperCard (a credit card). A spend reads "Rs. … spent on your Utkarsh SuperCard XX1234
// for UPI - <UPI id> on <date>" or "… for <shop> on <date>": the card's last four are taken in that spend shape only.
// Money paid to the card ("paid to your Utkarsh SuperCard", "for Utkarsh SuperCard XX1234 repayment", "towards …
// SuperCard … bill payment") is a card bill payment, kept in Review with the card's own digits. Ticket 173.

import type { FoundAccount } from "../extract/account";
import { cleanParty, NAME, sharedParty } from "./known";
import { cleanVpa, SmallFinanceParser } from "./small-finance-helpers";

const SPEND_CARD = /\bspent\son\syour\sUtkarsh\sSuperCard\s[x*]{0,8}(\d{4})\b/i;
// Money taken on the card itself ("EMI of Rs … debited on your Utkarsh SuperCard XX1234").
const ON_CARD = /\b(?:debited|charged)\son\syour\s(?:Utkarsh\s)?SuperCard\s[x*]{0,8}(\d{4})\b/i;
const ANY_CARD = /\bSuperCard\s[x*]{0,8}(\d{4})\b/i;
const CARD_NAME = String.raw`(?:Utkarsh\sSuperCard\b|\bSuperCard\s[x*]{0,8}\d{4}\b)`;
const PAID_TO_CARD = new RegExp(
  String.raw`\b(?:paid|payment|repayment|repaid|credited|received|towards)\b[^.]{0,60}?${CARD_NAME}|\bSuperCard\s[x*]{0,8}\d{4}\s(?:bill\s)?(?:repayment|payment)\b`,
  "i"
);

export class UtkarshParser extends SmallFinanceParser {
  readonly id = "utkarsh";
  readonly bankName = "Utkarsh Small Finance Bank";
  override readonly senderIds = ["UTKSPR", "UTKSFB"];

  protected readonly shapes = [/\bspent\son\syour\sUtkarsh\sSuperCard\s[x*]{0,8}\d{4}\sfor\s/i];

  protected override cardPayment(text: string): boolean {
    return (!SPEND_CARD.test(text) && PAID_TO_CARD.test(text)) || super.cardPayment(text);
  }

  protected override paidCard(text: string): FoundAccount | null {
    const card = text.match(ANY_CARD);
    return card ? { last4: card[1], instrument: "card" } : super.paidCard(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const card = text.match(SPEND_CARD) ?? text.match(ON_CARD);
    if (card) return { last4: card[1], instrument: "card" };
    return ANY_CARD.test(text) ? null : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (!SPEND_CARD.test(text)) return ANY_CARD.test(text) ? undefined : sharedParty(super.merchant(text, type));
    const upi = text.match(/\bfor\sUPI\s?[-–]\s?([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30}(?:\.[\w\-]{1,30}){0,2})(?![\w@])/i);
    if (upi) return cleanVpa(upi[1]);
    const shop = text.match(new RegExp(String.raw`\bSuperCard\s[x*]{0,8}\d{4}\sfor\s${NAME}\son\s`, "i"));
    return cleanParty(shop?.[1]);
  }
}
