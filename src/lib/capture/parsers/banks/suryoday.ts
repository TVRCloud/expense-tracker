// Suryoday Small Finance Bank credit card. A spend reads "Rs … spent on [<card name>] Suryoday SFB CC 1234 on <date>
// at <time>. Avlb Rs …": the card's last four follow "CC" in that spend shape only, the available limit follows "Avlb",
// and no shop is printed (the "to 9000…" in its help line is a phone number, never a payee). Money paid to the card
// ("paid towards / credited to / payment of … Suryoday SFB CC 1234") is a card bill payment, kept in Review. The
// "Avlb Rs …" figure is removed before the amount is read, so a spend abroad never books the limit. Ticket 173.

import type { FoundAccount } from "../extract/account";
import type { FoundAmount } from "../extract/amount";
import type { FoundFigure } from "../extract/balance";
import { toMinorUnits } from "../extract/amount";
import { cleanParty, moneySentence } from "./known";
import { SmallFinanceParser } from "./small-finance-helpers";

/** The sentence holding the amount: a promo or help line naming the card never decides anything. */
const money = (text: string) => moneySentence(text.replace(/\s+/g, " ").trim().replace(AVLB, " "));

const SPEND_CARD =
  /\bspent\s(?:on\s(?:[A-Za-z]{1,20}\s){0,3}|at\s[^.]{1,60}?\susing\s(?:your\s)?)Suryoday\sSFB\sCC\s(\d{4})\b/i;
const ANY_CARD = /\bSuryoday\sSFB\sCC\s(\d{4})\b/i;
const PAID_TO_CARD = /\b(?:paid|payment|repayment|credited|received|towards)\b[^.]{0,60}?\bSuryoday\sSFB\sCC\s\d{4}\b/i;
const AVLB = /\bAvlb\.?\s(?:Rs\.?|INR)\s?(\d{1,3}(?:,\d{2,3}){0,5}(?:\.\d{1,2})?|\d{1,13}(?:\.\d{1,2})?)(?![\d,])/i;

export class SuryodayParser extends SmallFinanceParser {
  readonly id = "suryoday";
  readonly bankName = "Suryoday Small Finance Bank";
  override readonly senderIds = ["SSFBNK"];

  protected readonly shapes = [/^(?:Rs\.?|INR)\s?[\d,.]{1,15}\sspent\son\s(?:[A-Za-z]{1,20}\s){0,3}Suryoday\sSFB\sCC\s\d{4}\b/i];

  protected override amount(text: string): FoundAmount | null {
    return super.amount(text.replace(AVLB, " "));
  }

  protected override cardPayment(text: string): boolean {
    const sentence = money(text);
    return (!SPEND_CARD.test(sentence) && PAID_TO_CARD.test(sentence)) || super.cardPayment(text);
  }

  protected override paidCard(text: string): FoundAccount | null {
    const card = text.match(ANY_CARD);
    return card ? { last4: card[1], instrument: "card" } : super.paidCard(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const sentence = money(text);
    const card = sentence.match(SPEND_CARD);
    if (card) return { last4: card[1], instrument: "card" };
    // A money sentence naming the card outside its spend shape never lends the card's digits to a bank account read.
    return ANY_CARD.test(sentence) ? null : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    // Its card messages name no shop; anything the shared reader finds is the help line.
    const sentence = money(text);
    const at = sentence.match(/\bspent\sat\s([^.]{1,60}?)\susing\s(?:your\s)?Suryoday\sSFB\sCC\s\d{4}\b/i);
    if (at) return cleanParty(at[1]);
    return ANY_CARD.test(sentence) ? undefined : super.merchant(text, type);
  }

  protected override availableLimit(text: string): FoundFigure | undefined {
    const m = text.match(AVLB);
    if (!m) return super.availableLimit(text);
    const minor = toMinorUnits(m[1]);
    return Number.isSafeInteger(minor) && minor > 0 && minor < 1e13 ? { minor } : undefined;
  }
}
