// Kerala Gramin Bank. A UPI debit names two accounts ("Your a/c no. XXXX1234 is debited for Rs.X ... and credited to
// a/c no. XXXXX5678 (UPI Ref no <ref>)"): the person's account is the one next to the verb that matches the direction.
// A credit reads "Account XXXX1234 is credited with INR X on <date> from <UPI id>".

import type { FoundAccount } from "../extract/account";
import { verbAccount } from "./known";
import { PrivateBankParser } from "./private-base";

export class KeralaGraminParser extends PrivateBankParser {
  readonly id = "kerala_gramin";
  readonly bankName = "Kerala Gramin Bank";
  override readonly senderIds = ["KGBANK"];

  protected readonly shapes = [
    /^Your\sa\/c\sno\.\sX{2,10}\d{4}\sis\sdebited\sfor\sRs\.?\s?[\d,.]{1,15}\son\s\S{1,10}\s[\d:]{4,5}\s[AP]M\sand\scredited\sto\sa\/c\sno\./i,
    /\bAccount\sX{2,10}\d{3,4}\sis\scredited\swith\sINR\s[\d,.]{1,15}\son\s/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    return verbAccount(text, type) ?? super.account(text, type);
  }
}
