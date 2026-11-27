// South Indian Bank. The direction comes before a colon with no verb ("UPI debit:Rs.X A/c X1234, <date> RRN: <ref>",
// "A/c X1234 DEBIT:Rs.X SHOP MCT Bal:Rs.Y", "UPI Credit:INR Rs.X in A/c X1234"); the other party sits in an
// "Info: <rail>/<bank code>/<ref>/ NAME" field.

import type { FoundDirection } from "../extract/direction";
import type { MoneyParse } from "../types";
import { cleanParty, REVIEW_CEILING, sharedParty } from "./known";
import { scrubParty } from "./party-scrub";
import { PrivateBankParser } from "./private-base";

const DEBIT_COLON = /\b(?:UPI\s)?debit:\s?(?:INR\s)?Rs\.?\s?\d/i;
const CREDIT_COLON = /\b(?:UPI\s)?credit:\s?(?:INR\s)?Rs\.?\s?\d/i;
// The token leads the message ("UPI debit:Rs.X", "A/c X1234 DEBIT:Rs.X"): only then is it what happened. "Last
// debit:Rs.X" in a balance message, "for debit:Rs.X ... returned" or "Hold debit:Rs.X" are not a transaction.
const LEADING_TOKEN = /^(?:UPI\s(?:debit|credit):|A\/c\sX\d{4}\s(?:DEBIT|CREDIT):)/i;
// A card bill paid from the account ("DEBIT:Rs.X CC PAYMENT SIB CARD MCT").
// "CC PAYMENT" (or "SIB CC PAYMENT") is the transaction type only right after the amount, never inside a shop name
// ("ABC CC PAYMENT SOLUTIONS").
const CC_PAYMENT =
  /\b(?:DEBIT:\s?Rs\.?\s?[\d,]{1,15}(?:\.\d{1,2})?\s(?:[A-Z]{2,6}\s)?|RRN:?\s?\d{6,22}\s)CC\sPAYMENT\b(?!\s(?:SOLUTIONS?|SERVICES?|LTD|LIMITED|PVT|CO)\b)/i;
// The bank's token counts only in its own part of the message, never inside the free Info text.
const ownPart = (text: string) => text.split(/\b(?:Info|Remarks|Note)\s?[:\-]/i)[0];
// "UPI debit:Rs.X A/c X1234 reversed": the token no longer says what happened; kept in Review.
const UNDONE = /\b(?:revers(?:ed|al)|returned|refunded|cancelled|failed)\b/i;

export class SouthIndianParser extends PrivateBankParser {
  readonly id = "south_indian";
  readonly bankName = "South Indian Bank";
  override readonly senderIds = ["SIBSMS"];

  protected readonly shapes = [
    /^UPI\s(?:debit|Credit):\s?(?:INR\s)?Rs\.?\s?[\d,.]{1,15},?\s(?:in\s)?A\/c\sX\d{4}\b/i,
    /^A\/c\sX\d{4}\sDEBIT:\s?Rs\.?\s?[\d,.]{1,15}\s/i,
    /\bYour\sA\/c\sX\d{4}\sis\scredited\swith\sRs\.?\s?[\d,.]{1,15}\sInfo:\s?(?:IMPS|NEFT|UPI)\//i,
  ];

  protected override direction(text: string): FoundDirection | null {
    // The bank's own token decides when it leads the message or the message is one of its shapes, whatever the Info
    // text says ("UPI Credit:... Info: ... Paid via PhonePe" is money in; "UPI debit:... Received with thanks" is out).
    const own = ownPart(text);
    if (!UNDONE.test(own)) {
      // The token that leads the message decides, even when another one follows it.
      const lead = text.match(LEADING_TOKEN)?.[0];
      if (lead) return { type: /debit/i.test(lead) ? "expense" : "income", ambiguous: false };
      const debit = DEBIT_COLON.test(own);
      const credit = CREDIT_COLON.test(own);
      if (debit !== credit && this.hasShape(text)) return { type: debit ? "expense" : "income", ambiguous: false };
    }
    return super.direction(text);
  }

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    // The bank's token next to a word that undoes it: whatever the shared rules read, it is checked in Review.
    const own = ownPart(text);
    if (parse && (DEBIT_COLON.test(own) || CREDIT_COLON.test(own)) && UNDONE.test(own) && parse.confidence > REVIEW_CEILING) {
      return { ...parse, confidence: REVIEW_CEILING };
    }
    return parse;
  }

  protected override cardPayment(text: string): boolean {
    return CC_PAYMENT.test(text) || super.cardPayment(text);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const shop = text.match(/\bDEBIT:\s?Rs\.?\s?[\d,]{1,15}(?:\.\d{1,2})?\s(\S[^.;:]{0,58}?)\s(?:MCT\s)?Bal:/i);
    const info = text.match(/\bInfo:\s?(?:UPI|IMPS|NEFT)\/[A-Za-z]{3,5}\/\d{6,22}\/\s?(\S[^/;]{0,58}?)(?:\son\s\d|\.\s|\.$|$)/i);
    if (CC_PAYMENT.test(text)) return undefined;
    // South Indian masks accounts with one X ("A/c X5521"), so a one-X code after a name is a mask ("RAVI X7781").
    const sib = (v: string | undefined) => scrubParty(v?.replace(/\s[xX]\d{4}$/, ""));
    return sib(cleanParty(shop?.[1])) ?? sib(cleanParty(info?.[1])) ?? sib(sharedParty(super.merchant(text, type)));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bInfo:\s?(?:UPI|IMPS|NEFT)\/[A-Za-z]{3,5}\/(\d{6,22})\//i)?.[1] ?? super.ref(text);
  }
}
