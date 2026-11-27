// Jupiter Edge, a RuPay credit card issued with CSB Bank. A spend is written "Rs.63.45 debited to your Edge CSB Bank
// RuPay Credit Card ending 4417 on <date> ...": "debited to your ... Credit Card" is a spend on the card, never a
// payment to it. A credit to the card is a bill payment unless the sentence that holds the amount says refund,
// reversal or cashback (a promo line after it does not count). Its dates are month first ("11/5/26" is 5 November),
// which the shared reader would read day first, so this parser reads them itself.

import { AMT, AppParser } from "./app-shared";
import { moneySentence } from "./known";
import { istToDate, type ParsedDate } from "../dates";
import { CREDIT_WORDS } from "../extract/direction";

const EDGE = String.raw`(?:Edge\s)?(?:CSB\sBank\s)?(?:RuPay\s)?Credit\sCard\sending\s\d{4}`;
const MONTH_FIRST = /\bon\s(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s(?:at\s)?(\d{1,2}):(\d{2})\s?([AP]M)?)?(?!\d)/i;
// A message is sent right after the payment: a date later than a few minutes after it arrived is not trusted.
const FUTURE_SLACK_MS = 10 * 60 * 1000;

export class JupiterParser extends AppParser {
  readonly id = "jupiter";
  readonly bankName = "CSB Bank (Jupiter Edge)";
  override readonly senderIds = ["JTEDGE"];

  protected readonly shapes = [
    new RegExp(String.raw`^${AMT}\sdebited\sto\syour\s${EDGE}\b`, "i"),
    new RegExp(String.raw`^(?:Refund\sof\s)?${AMT}\s(?:refund\s)?(?:has\sbeen\s)?credited\sto\syour\s${EDGE}\b`, "i"),
  ];

  protected override cardPayment(text: string): boolean {
    const sentence = moneySentence(text);
    if (/\bdebited\sto\syour\b[^.]{0,40}?\bcredit\scard\b/i.test(sentence)) return false;
    if (/\brefund(?:ed)?\b|\breversal\b|\breversed\b|\bcashback\b/i.test(sentence)) return false;
    if (/\bcredited\sto\syour\b[^.]{0,40}?\bcredit\scard\b/i.test(sentence) && CREDIT_WORDS.test(sentence)) return true;
    return super.cardPayment(text);
  }

  /** "on M/D/YY[, h:mm AM]". A date more than ten minutes after the message arrived is not trusted: the
   * received time is used instead. */
  protected override date(text: string, receivedAt: Date): ParsedDate | null {
    const m = text.match(MONTH_FIRST);
    if (!m) return super.date(text, receivedAt);
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let hours = m[4] ? Number(m[4]) : 12;
    const minutes = m[5] ? Number(m[5]) : 0;
    if (m[6]) hours = (hours % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0);
    if (hours > 23 || minutes > 59) return null;
    // "2/30/26" is no date.
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    const date = istToDate(year, month - 1, day, hours, minutes);
    if (date.getTime() > receivedAt.getTime() + FUTURE_SLACK_MS) return null;
    return { date, hasTime: Boolean(m[4]) };
  }
}
