// City Union Bank. A UPI message names two accounts ("Your a/c no. XXXX1234 is debited for Rs.X on <date> and
// credited to a/c no. XXXX5678 (UPI Ref no <ref>)"): the person's account is the one next to the verb that matches the
// direction.

import type { FoundAccount } from "../extract/account";
import { KnownBankParser, verbAccount } from "./known";

export class CityUnionParser extends KnownBankParser {
  readonly id = "city_union";
  readonly bankName = "City Union Bank";
  override readonly senderIds = ["CUBANK"];

  protected readonly shapes = [
    /^Your\sa\/c\sno\.\sX{2,14}\d{4}\sis\s(?:debited|credited)\sfor\sRs\.?\s?[\d,.]{1,15}\son\s\S{1,12}\sand\s(?:credited\sto|debited\sfrom)\sa\/c\sno\.\sX{2,14}\d{4}\s\(UPI\sRef\sno\s\d{6,22}\)/i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    return verbAccount(text, type) ?? super.account(text, type);
  }
}
