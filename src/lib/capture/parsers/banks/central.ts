// Central Bank of India. One sentence with the account in lower-case x's and the other party after "By." or "To."
// right before the sign-off ("… credited to your A/c xxxxxx7719 on 04/11/2026 through NEFT vide Ref No./<ref>
// By.NAME-CBoI").

import { cleanParty, sharedParty } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

export class CentralParser extends PublicSectorParser {
  readonly id = "central";
  readonly bankName = "Central Bank of India";
  override readonly senderIds = ["CENTBK"];

  protected readonly shapes = [/^Rs\.\s?[\d,.]{1,15}\s(?:credited|debited)\s(?:to|from)\syour\sA\/c\sx{2,8}\d{4}\son\s\S{8,10}\sthrough\s/i];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const party = text.match(/\b(?:By|To)\.\s?([^.;]{1,60}?)\s?-\s?CBoI\b/i);
    // "By.REFUND SHOPKART will be credited in 5 days": the name only, without the refund word or the promise.
    const name = party?.[1].replace(/^(?:REFUND|REV(?:ERSAL)?)\s(?:FROM\s)?/i, "").replace(/\s(?:will\b|in\s\d)[^]{0,60}$/i, "");
    if (party) return nameOnly(name);
    return nameOnly(sharedParty(super.merchant(text, type)));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bRef\sNo\.\s?\/?\s?([A-Za-z0-9]{6,22})\b/i)?.[1] ?? super.ref(text);
  }
}
