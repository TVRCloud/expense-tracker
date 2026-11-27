// Jupiter Edge, a RuPay credit card issued with CSB Bank. A spend is written "Rs.63.45 debited to your Edge CSB Bank
// RuPay Credit Card ending 4417 on <date> - (UPI Ref no.<ref>)": "debited to your ... Credit Card" is a spend on the
// card, never a payment to it. A credit to the card is a bill payment unless it says refund, reversal or cashback.

import { AMT, AppParser } from "./app-shared";
import { CREDIT_WORDS } from "../extract/direction";

const EDGE = String.raw`(?:Edge\s)?(?:CSB\sBank\s)?(?:RuPay\s)?Credit\sCard\sending\s\d{4}`;

export class JupiterParser extends AppParser {
  readonly id = "jupiter";
  readonly bankName = "CSB Bank (Jupiter Edge)";
  override readonly senderIds = ["JTEDGE"];

  protected readonly shapes = [
    new RegExp(String.raw`^${AMT}\sdebited\sto\syour\s${EDGE}\b`, "i"),
    new RegExp(String.raw`^${AMT}\s(?:has\sbeen\s)?credited\sto\syour\s${EDGE}\b`, "i"),
  ];

  protected override cardPayment(text: string): boolean {
    if (/\bdebited\sto\syour\b[^.]{0,40}?\bcredit\scard\b/i.test(text)) return false;
    if (/\brefund(?:ed)?\b|\breversal\b|\breversed\b|\bcashback\b/i.test(text)) return false;
    if (/\bcredited\sto\syour\b[^.]{0,40}?\bcredit\scard\b/i.test(text) && CREDIT_WORDS.test(text)) return true;
    return super.cardPayment(text);
  }
}
