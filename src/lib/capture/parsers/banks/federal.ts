// Federal Bank. A UPI debit reads "Debited Rs X from a/c X1234 ... via UPI to <UPI id>" or "Rs X debited via UPI ...
// to VPA <UPI id>"; a credit can be written to the person by name ("..., you've received INR X in your Account
// XXXX1234 ... It was sent by NAME on <month> <day>, <year>"); a card payment under an e-mandate names the payee
// after "for" and the card as "Federal Bank Debit Card 1234".

import type { FoundAccount } from "../extract/account";
import { cleanParty, KnownBankParser, NAME, sharedParty } from "./known";

export class FederalParser extends KnownBankParser {
  readonly id = "federal";
  readonly bankName = "Federal Bank";
  override readonly senderIds = ["FEDBNK", "FEDFIB"];

  protected readonly shapes = [
    /^Debited\sRs\.?\s?[\d,.]{1,15}\sfrom\sa\/c\sX{1,8}\d{4}\son\s\S{1,12}\s[\d:]{4,8}\svia\sUPI\sto\s/i,
    /^Rs\.?\s?[\d,.]{1,15}\s(?:debited|credited)\svia\s(?:UPI|IMPS|NEFT)\son\s/i,
    /^Rs\.?\s?[\d,.]{1,15}\scredited\sto\syour\sA\/c\sX{1,8}\d{4}\svia\s(?:IMPS|NEFT|UPI)\b/i,
    /\byou'?ve\sreceived\sINR\s[\d,.]{1,15}\sin\syour\sAccount\sX{2,12}\d{4}\b/i,
    /\bpayment\sof\sINR\s[\d,.]{1,15}\sfor\s[^.]{1,60}?\svia\se-mandate\b[^.]{0,60}?\son\sFederal\sBank\s(?:Debit|Credit)\sCard\s\d{4}\sis\sprocessed\b/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const card = text.match(/\bFederal\sBank\s(?:Debit|Credit)\sCard\s[x*]{0,4}(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const mandate = text.match(new RegExp(String.raw`\bpayment\sof\sINR\s[\d,.]{1,15}\sfor\s${NAME}\svia\se-mandate\b`, "i"));
    const sentBy = text.match(new RegExp(String.raw`\bIt\swas\ssent\sby\s${NAME}\son\s[A-Za-z]{3,9}\s\d{1,2}\b`, "i"));
    return cleanParty(mandate?.[1]) ?? cleanParty(sentBy?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
