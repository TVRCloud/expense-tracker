// Tamilnad Mercantile Bank. "Your A/c No.XXXX1234 is debited with Rs.X on <date> <time> and <bank> A/c linked to
// <UPI id> is credited (UPI Ref No.<ref>).Current AVBL bal is Rs.Y - TMB": the person's account is the one next to the
// verb that matches the direction, the other party the UPI id after "linked to".

import type { FoundAccount } from "../extract/account";
import { KnownBankParser, sharedParty, verbAccount } from "./known";

export class TamilnadMercantileParser extends KnownBankParser {
  readonly id = "tmb";
  readonly bankName = "Tamilnad Mercantile Bank";
  override readonly senderIds = ["TMBANK"];

  protected readonly shapes = [/^Your\sA\/c\sNo\.\s?X{2,12}\d{4}\sis\s(?:debited|credited)\swith\sRs\.?\s?[\d,.]{1,15}\son\s/i];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    return verbAccount(text, type) ?? super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const linked = text.match(/\blinked\sto\s\**([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i);
    return linked?.[1] ?? sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI\sRef\sNo\.?\s?(\d{6,22})\b/i)?.[1] ?? super.ref(text);
  }
}
