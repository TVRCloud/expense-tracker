// OneCard, a credit card app. Its spends start with "You've" and carry no debit word: "You've made a transaction of
// Rs. 413.60 on SHOP on card ending 4417", "You've fueled up for Rs. 1,265.30 at PUMP on card ending 4417". Only those
// spend verbs are read as a spend on the card. A cashback, a refund or an EMI conversion of an earlier purchase (no new
// money spent) goes through the shared rules; a bill payment received on the card is a card payment.

import { AMT, AppParser, YOUVE } from "./app-shared";
import { cleanParty, NAME } from "./known";
import type { FoundDirection } from "../extract/direction";

const SPEND_VERB = String.raw`(?:made\sa\s(?:transaction|booking|purchase|payment)|fueled\sup|shopped|spent|paid|hand-picked\s[a-z]{3,20})`;
// "on OneCard" is a payment to the card itself (its bill), never a shop.
const SPEND = new RegExp(String.raw`^${YOUVE}\s${SPEND_VERB}\s(?:of|for)\s${AMT}\s(?:at|on)\s(?!OneCard\b)${NAME}\son\s(?:your\s)?card\sending\s\d{4}\b`, "i");
// "You've converted a transaction of ... into EMI": the purchase was already spent. Only that opening counts, so a
// spend followed by "Convert it to EMI in the app", or a shop called "EMI MART", is still a spend.
const NOT_A_SPEND = new RegExp(String.raw`^${YOUVE}\sconverted\b`, "i");
// The card's bill paid: "You've made a payment of Rs. 6,110.00 on OneCard ...", "Payment of Rs. ... received on card".
const BILL_PAID = new RegExp(
  String.raw`^${YOUVE}\smade\sa\spayment\sof\s${AMT}\s(?:on|to|towards)\s(?:your\s)?OneCard\b|\b(?:re)?payment\sof\s${AMT}\s(?:has\sbeen\s)?received\s(?:on|towards|for)\s(?:your\s)?(?:OneCard\s)?card\sending\s\d{4}\b`,
  "i"
);

export class OneCardParser extends AppParser {
  readonly id = "onecard";
  readonly bankName = "OneCard";
  override readonly senderIds = ["ONECRD"];

  protected readonly shapes = [SPEND];

  protected override direction(text: string): FoundDirection | null {
    if (SPEND.test(text) && !NOT_A_SPEND.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  /** The bill paid: "You've made a payment of ... on OneCard", "Payment of Rs. 6,110.00 received on card ending 4417"
   * (the shared rule stops at the "." of "Rs."). */
  protected override cardPayment(text: string): boolean {
    if (BILL_PAID.test(text)) return true;
    return super.cardPayment(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    return cleanParty(text.match(SPEND)?.[1]) ?? super.merchant(text, type);
  }
}
