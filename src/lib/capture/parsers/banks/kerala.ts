// Kerala Bank (Kerala State Co-operative Bank). "Dear Customer Your A/c no XXXX1234 is credited with 3200.00 on <date>
// by NEFT From : NAME. Balance is Y": the amount has no currency and the other party follows "From :" or "To :". A
// loan recovery credited to a loan account (or a negative balance) is not the person's own money moving, so it stays
// in Review.

import type { MoneyParse } from "../types";
import { cleanParty, KnownBankParser, REVIEW_CEILING, sharedParty } from "./known";

const LOAN = /\bLoan\sRecovery\b|\bBalance\sis\s-\s?\d/i;

export class KeralaParser extends KnownBankParser {
  readonly id = "kerala";
  readonly bankName = "Kerala Bank";
  override readonly senderIds = ["KELBNK"];

  protected readonly shapes = [/^Dear\sCustomer\sYour\sA\/c\sno\sX{2,10}\d{4}\sis\s(?:credited|debited)\swith\s[\d,.]{1,15}\son\s/i];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (parse && LOAN.test(text) && parse.confidence > REVIEW_CEILING) return { ...parse, confidence: REVIEW_CEILING };
    return parse;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const party = text.match(new RegExp(String.raw`\b${type === "income" ? "From" : "To"}\s?:\s?(\S[^.;:]{0,58}?)(?:\.\s|\.$|$)`, "i"));
    return cleanParty(party?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
