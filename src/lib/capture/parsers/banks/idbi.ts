// IDBI Bank. A UPI debit names the payee after the balance and before "credited" ("Acct XX1234 debited for Rs X on
// <date>; Bal Rs Y NAME credited. UPI:<ref>"); the reference is written "UPI:<12 digits>". An AutoPay debit names the
// payee after "towards" and before "for AutoPay".

import { cleanParty, creditedParty, NAME, sharedParty } from "./known";
import { PrivateBankParser } from "./private-base";

export class IdbiParser extends PrivateBankParser {
  readonly id = "idbi";
  readonly bankName = "IDBI Bank";
  override readonly senderIds = ["IDBIBK"];

  protected readonly shapes = [
    /^IDBI\sBank\sAcct\sXX\d{4}\sdebited\sfor\sRs\.?\s?[\d,.]{1,15}\son\s\S{1,12};/i,
    /\bAcct\sXX\d{4}\sis\scredited\swith\sRs\.?\s?[\d,.]{1,15}\son\s\S{1,12}\sfrom\s/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    // "; Bal Rs 6,180.55 SHOP NAME credited." : the name sits between the balance figure and "credited".
    const afterBalance = text.match(new RegExp(String.raw`;\s?Bal\sRs\.?\s?[\d,]{1,15}(?:\.\d{1,2})?\s${NAME}\scredited\b`, "i"));
    const autoPay = text.match(new RegExp(String.raw`\btowards\s${NAME}\sfor\sAuto\s?Pay\b`, "i"));
    return (
      cleanParty(afterBalance?.[1]) ??
      cleanParty(autoPay?.[1]) ??
      (/;\s?Bal\b/i.test(text) ? undefined : creditedParty(text)) ??
      sharedParty(super.merchant(text, type))
    );
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI:(\d{12})\b/)?.[1] ?? super.ref(text);
  }
}
