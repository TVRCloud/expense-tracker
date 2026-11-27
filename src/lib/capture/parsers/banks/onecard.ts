// OneCard, a credit card app. Its spends start with "You've" and carry no debit word: "You've made a transaction of
// Rs. 413.60 on SHOP on card ending 4417", "You've fueled up for Rs. 1,265.30 at PUMP on card ending 4417". Those
// shapes are read as spends on the card; anything else (a refund, a bill payment) goes through the shared rules.

import { AMT, AppParser } from "./app-shared";
import { cleanParty, NAME } from "./known";
import type { FoundDirection } from "../extract/direction";

const SPEND = new RegExp(String.raw`^You'?ve\s[A-Za-z' -]{3,40}?\s(?:of|for)\s${AMT}\s(?:at|on)\s${NAME}\son\s(?:your\s)?card\sending\s\d{4}\b`, "i");

export class OneCardParser extends AppParser {
  readonly id = "onecard";
  readonly bankName = "OneCard";
  override readonly senderIds = ["ONECRD"];

  protected readonly shapes = [SPEND];

  protected override direction(text: string): FoundDirection | null {
    if (SPEND.test(text) && !/\brefund(?:ed)?\b|\breversed\b|\bcredited\b/i.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    return cleanParty(text.match(SPEND)?.[1]) ?? super.merchant(text, type);
  }
}
