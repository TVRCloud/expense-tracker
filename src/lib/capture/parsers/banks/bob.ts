// Bank of Baroda and BOBCARD. An account alert puts "Dr."/"Cr." right after the amount ("Rs.318.00 Dr. from A/c
// XX719628 …", "Rs.1,297.00 Cr. to anita@okicici A/c XX719628 …": money in, from that UPI id); a transfer names the
// account with dots ("from A/c ...7193 to:NAME."); an account number may show six digits ("XX719628", last four 9628);
// a card spend reads "spent on your BOBCARD ending 3381 at SHOP". A "Cr"/"Dr" after a balance is the balance's sign,
// never the money's direction; BOBCARD is a credit card, so paying it is a card bill payment.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, moneySentence, NAME, sharedParty, verbAccount } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

/** "Dr."/"Cr." right after the message's first amount, which must not be a balance or an available amount. */
const FIRST_AMOUNT_DR_CR = /^(?:ALERT:\s)?(?:Rs\.?|INR|₹)\s?[\d,]{1,12}(?:\.\d{1,2})?\s(Dr|Cr)\.?\s/i;
/** A loan account in the message: money into a loan is its repayment, read by the shared loan rule. */
const LOAN = /\bloan\s(?:a\/c|acct|account)\b/i;
/** Money into or for a BOBCARD (a credit card): its bill, never spending or income. */
const BOBCARD_PAID =
  /\b(?:payment\sof\s(?:Rs\.?|INR|₹)\s?[\d,.]{1,15}\s(?:on|towards|to|for)\s(?:your\s)?BOBCARD|credited\sto\s(?:your\s)?BOBCARD|BOBCARD\s(?:bill\s)?payment|to:\s?BOBCARD(?:\s(?:ending\s)?[x*]{0,4}\d{4})?(?=\.|,|$|\s(?:Total|on|Ref)\b)|towards\s(?:your\s)?BOBCARD\b|payment\s(?:of\s(?:Rs\.?|INR|₹)\s?[\d,.]{1,15}\s)?received\stowards\s(?:your\s)?BOBCARD|BOBCARD\s(?:ending\s)?\d{4}\spayment\sof\s(?:Rs\.?|INR|₹)\s?[\d,.]{1,15}\s(?:has\sbeen\s)?(?:received|credited))/i;

export class BobParser extends PublicSectorParser {
  readonly id = "bob";
  readonly bankName = "Bank of Baroda";
  override readonly senderIds = ["BOBSMS", "BOBTXN", "BOBCRD"];
  override readonly packageNames = ["com.bankofbaroda.mconnect"];

  protected readonly shapes = [
    /^Rs\.[\d,.]{1,15}\s(?:Dr|Cr)\.\s(?:from|to)\s/i,
    /^Rs\.[\d,.]{1,15}\stransferred\sfrom\sA\/c\s\.{2,4}\d{4}\sto:/i,
    /^Rs\.[\d,.]{1,15}\scredited\sto\sA\/c\sX{1,8}\d{4,8}\svia\s/i,
    /\bspent\son\syour\sBOBCARD\sending\s\d{4}\b/i,
  ];

  protected override cardPayment(text: string): boolean {
    // A spend or a refund on the card is never its bill payment, whatever a promo line after it says ("Make your BOBCARD
    // payment on time"): only the sentence holding the amount is read.
    const sentence = moneySentence(text);
    if (/\b(?:spent|refund(?:ed)?)\b/i.test(sentence)) return super.cardPayment(text);
    return BOBCARD_PAID.test(sentence) || super.cardPayment(text);
  }

  protected override paidCard(text: string): FoundAccount | null {
    const card = text.match(/\bBOBCARD\s(?:ending\s)?(?:[x*]{0,8})(\d{4})\b/i);
    return card ? { last4: card[1], instrument: "card" } : super.paidCard(text);
  }

  protected override direction(text: string): FoundDirection | null {
    if (LOAN.test(text)) return super.direction(text);
    const drCr = text.match(FIRST_AMOUNT_DR_CR);
    if (drCr) return { type: drCr[1].toLowerCase() === "dr" ? "expense" : "income", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Two accounts in one message: the one next to the verb that matches the direction (ticket 156).
    const moved = verbAccount(text, type);
    if (moved) return moved;
    const card = text.match(/\bBOBCARD\sending\s(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    const acct = text.match(/(?<!\b(?:loan|card|BOBCARD)\s)\bA\/c\s(?:\.{2,4}|[X*]{1,8})\d{0,8}?(\d{4})\b/i);
    if (acct) return { last4: acct[1], instrument: "account" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    // A cash deposit names no payer; a card bill payment has no other party (the card is the person's own).
    if (/\bdeposited\sin\scash\b/i.test(text) || this.cardPayment(text)) return undefined;
    const toColon = text.match(new RegExp(String.raw`\bto:\s?${NAME}\.(?:\s|$)`, "i"));
    const crTo = text.match(/\bCr\.\sto\s([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i);
    const name = cleanParty(toColon?.[1]) ?? crTo?.[1] ?? sharedParty(super.merchant(text, type));
    // A card's own name and digits are never the other party ("to:BOBCARD 3381"); a shop called "BOBCARD STATIONERS" is.
    return name && !/^BOBCARD(?:\s(?:ending\s)?[x*]{0,4}\d{4})?$/i.test(name) ? nameOnly(name) : undefined;
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bRef:\s?(\d{6,16})\b/i)?.[1] ?? text.match(/\bIMPS\/(\d{12})\b/)?.[1] ?? super.ref(text);
  }
}
