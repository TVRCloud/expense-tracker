// J&K Bank. "Your A/c XXXX1234 is Debited by INR X at <time> by RTGS-<ref>. A/C Bal is INR Y Cr." and the same with
// "Credited with"; the reference follows the rail and a dash.

import { KnownBankParser } from "./known";

export class JkParser extends KnownBankParser {
  readonly id = "jk";
  readonly bankName = "J&K Bank";
  override readonly senderIds = ["JKBANK"];

  protected readonly shapes = [/^Your\sA\/c\sX{2,12}\d{4}\sis\s(?:Debited\sby|Credited\swith)\sINR\s[\d,.]{1,15}\s/i];

  protected override ref(text: string): string | undefined {
    return text.match(/\b(?:RTGS|NEFT|IMPS)-([A-Z0-9]{8,22})\b/)?.[1] ?? super.ref(text);
  }
}
