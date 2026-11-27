// Dhanlaxmi Bank. A UPI message carries a quoted "UPI TXN: /<ref>-<note> /..." field: an expense names the payee's UPI
// id between slashes, an income names the payer after "Payment from"; a two-account message ("is credited for Rs.X
// ... and debited from a/c no. XXXX5678") takes the account next to the verb that matches the direction.

import type { FoundAccount } from "../extract/account";
import { cleanParty, sharedParty, verbAccount } from "./known";
import { PrivateBankParser } from "./private-base";

// "Payment from PhonePe" names the app the money came through, not a person.
const APP = /^(?:PhonePe|GPay|Google\sPay|Paytm|BHIM|Amazon\sPay|CRED|Mobikwik)$/i;

export class DhanlaxmiParser extends PrivateBankParser {
  readonly id = "dhanlaxmi";
  readonly bankName = "Dhanlaxmi Bank";
  override readonly senderIds = ["DHANBK"];

  protected readonly shapes = [
    /^INR\s[\d,.]{1,15}\sis\s(?:debited\sfrom|credited\sto)\sA\/c\sX{2,10}\d{4}\son\s\S{1,12}\s-\s"?UPI\sTXN:/i,
    /^Your\sa\/c\sno\.\sX{2,12}\d{4}\sis\s(?:credited|debited)\sfor\sRs\.?\s?[\d,.]{1,15}\son\s\S{1,12}\sand\s(?:debited\sfrom|credited\sto)\sa\/c\sno\./i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    return verbAccount(text, type) ?? super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (/\bUPI\sTXN:/i.test(text)) {
      if (type === "expense") return text.match(/\/([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})\//)?.[1];
      const from = cleanParty(text.match(/\/Payment\sfrom\s([A-Za-z][A-Za-z .]{1,40}?)\s?(?:\/|"|$)/i)?.[1]);
      return from && !APP.test(from) ? from : undefined;
    }
    return sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI\sTXN:\s?\/(\d{12})\b/i)?.[1] ?? super.ref(text);
  }
}
