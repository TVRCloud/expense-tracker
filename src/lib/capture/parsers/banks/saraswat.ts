// Saraswat Bank. "Your A/c no. 1234 is credited with INR X on <date> towards ACH Credit:NAME. Current Bal is INR Y CR"
// and "Your account no. ending with 1234 is debited with INR X on <date> for IMPS": the payer of an ACH credit follows
// "ACH Credit:".

import { cleanParty, sharedParty } from "./known";
import { scrubParty } from "./party-scrub";
import { PrivateBankParser } from "./private-base";

export class SaraswatParser extends PrivateBankParser {
  readonly id = "saraswat";
  readonly bankName = "Saraswat Bank";
  override readonly senderIds = ["SARBNK"];

  protected readonly shapes = [
    /^(?:Dear\sCustomer,\s)?Your\s(?:A\/c\sno\.\s\d{4}|account\sno\.\sending\swith\s\d{4})\sis\s(?:credited|debited)\swith\sINR\s/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const ach = text.match(/\bACH\s(?:Credit|Debit):\s?(\S[^.;]{0,58}?)(?:\.\s|\.$|$)/i);
    return scrubParty(cleanParty(ach?.[1])) ?? scrubParty(sharedParty(super.merchant(text, type)));
  }
}
