// OneCard, a credit card app. Its spends start with "You've" and carry no debit word: "You've made a transaction of
// Rs. 413.60 on SHOP on card ending 4417", "You've fueled up for Rs. 1,265.30 at PUMP on card ending 4417". Only those
// spend verbs are read as a spend on the card. A cashback, a refund or an EMI conversion of an earlier purchase (no new
// money spent) goes through the shared rules; a bill payment received on the card is a card payment.

import { AMT, AppParser, YOUVE } from "./app-shared";
import { cleanParty, NAME } from "./known";
import type { FoundDirection } from "../extract/direction";

const SPEND_VERB = String.raw`(?:made\sa\s(?:transaction|booking|purchase|payment)|fueled\sup|shopped|spent|paid|hand-picked\s[a-z]{3,20})`;
const SPEND = new RegExp(String.raw`^${YOUVE}\s${SPEND_VERB}\s(?:of|for)\s${AMT}\s(?:at|on)\s${NAME}\son\s(?:your\s)?card\sending\s\d{4}\b`, "i");
// "You've converted a transaction of ... into EMI": the purchase was already spent.
const NOT_A_SPEND = /\bconvert(?:ed)?\b|\bEMIs?\b/i;

export class OneCardParser extends AppParser {
  readonly id = "onecard";
  readonly bankName = "OneCard";
  override readonly senderIds = ["ONECRD"];

  protected readonly shapes = [SPEND];

  protected override direction(text: string): FoundDirection | null {
    if (SPEND.test(text) && !NOT_A_SPEND.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  /** "Payment of Rs. 6,110.00 received on card ending 4417": the bill paid (the shared rule stops at the "." of "Rs."). */
  protected override cardPayment(text: string): boolean {
    if (new RegExp(String.raw`\b(?:re)?payment\sof\s${AMT}\s(?:has\sbeen\s)?received\s(?:on|towards|for)\s(?:your\s)?(?:OneCard\s)?card\sending\s\d{4}\b`, "i").test(text)) return true;
    return super.cardPayment(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    return cleanParty(text.match(SPEND)?.[1]) ?? super.merchant(text, type);
  }
}
