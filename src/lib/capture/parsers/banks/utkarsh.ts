// Utkarsh Small Finance Bank SuperCard (a credit card). A spend reads "Rs. … spent on your Utkarsh SuperCard XX1234
// for UPI - <UPI id> on <date>" or "… for <shop> on <date>". Ticket 173.

import type { FoundAccount } from "../extract/account";
import { cleanParty, KnownBankParser, NAME, sharedParty } from "./known";

const CARD = /\bSuperCard\s[x*]{0,8}(\d{4})\b/i;

export class UtkarshParser extends KnownBankParser {
  readonly id = "utkarsh";
  readonly bankName = "Utkarsh Small Finance Bank";
  override readonly senderIds = ["UTKSPR", "UTKSFB"];

  protected readonly shapes = [/\bspent\son\syour\sUtkarsh\sSuperCard\s[x*]{0,8}\d{4}\sfor\s/i];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const card = text.match(CARD);
    return card ? { last4: card[1], instrument: "card" } : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const upi = text.match(/\bfor\sUPI\s?[-–]\s?([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i);
    if (upi) return upi[1];
    const shop = text.match(new RegExp(String.raw`\bSuperCard\s[x*]{0,8}\d{4}\sfor\s${NAME}\son\s`, "i"));
    return cleanParty(shop?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
