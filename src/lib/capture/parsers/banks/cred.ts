// CRED. Its own SMS confirm a credit card bill paid through the app: "Payment of Rs.8,465 has been successfully
// credited towards your ICICI Bank Credit Card." That is money between the person's own accounts, so it is a card
// payment (Review, never income or spending). The bank named is the card's, which helps the person pick the card.
// Other CRED messages (a UPI payment, rent) only repeat the paying bank's message: the generic parser reads them as
// before. Only the CREDIN SMS header is claimed, not the CRED app's package, so its notifications read as before.

import { AMT, AppParser } from "./app-shared";
import { isCardPayment } from "../extract/direction";
import type { MoneyParse } from "../types";

export class CredParser extends AppParser {
  readonly id = "cred";
  // The card's bank from the text ("ICICI Bank"), not CRED: it is the card that was paid.
  readonly bankName = undefined;
  override readonly senderIds = ["CREDIN"];

  protected readonly shapes = [
    new RegExp(String.raw`^Payment\sof\s${AMT}\shas\sbeen\s(?:successfully\s)?credited\stowards\syour\s[A-Za-z ]{2,40}?Credit\sCard\b`, "i"),
  ];

  /** Only CRED's own card bill shape, or a message the shared rule already calls a card payment. A spend made with a
   * card ("payment of Rs 799 to Airtel using credit card") is never one, so it goes to the generic parser. */
  /** CRED's own bill shape is a card payment even when a cashback line follows it ("You earned cashback of Rs.20"). */
  protected override cardPayment(text: string): boolean {
    return this.hasShape(text.replace(/\s+/g, " ").trim()) || super.cardPayment(text);
  }

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const flat = text.replace(/\s+/g, " ").trim();
    if (!this.hasShape(flat) && !isCardPayment(flat)) return null;
    const parse = super.parse(text, receivedAt);
    return parse?.cardPayment ? parse : null;
  }
}
