// Cashfree, a payment gateway. Its "Payment INR 452.70 (ID:<id>) confirmed for order #<order> on SHOP. Powered by
// Cashfree" is a receipt for money the person paid from a bank, card or UPI app whose own message records it too.
// Both arrive as SMS, which ingest does not match against each other, so this read is always kept in Review (at most
// 0.5) with the shop named, for the person to see it is the same payment. Anything else from Cashfree goes to the
// generic parser.

import { AMT, AppParser } from "./app-shared";
import { cleanParty, NAME } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import type { MoneyParse } from "../types";

const RECEIPT = new RegExp(String.raw`^Payment\s(?:of\s)?${AMT}\s\(ID:\s?(\d{6,20})\)\sconfirmed\sfor\sorder\s#?\S{1,60}\son\s${NAME}(?:\.\s|\.$|$)`, "i");

export class CashfreeParser extends AppParser {
  readonly id = "cashfree";
  readonly bankName = "Cashfree";
  override readonly senderIds = ["CSHFRE"];
  protected override readonly ceiling = 0.5;

  protected readonly shapes = [RECEIPT];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    return RECEIPT.test(text.replace(/\s+/g, " ").trim()) ? super.parse(text, receivedAt) : null;
  }

  protected override direction(): FoundDirection | null {
    return { type: "expense", ambiguous: false };
  }

  protected override account(): FoundAccount | null {
    return null;
  }

  protected override merchant(text: string): string | undefined {
    return cleanParty(text.match(RECEIPT)?.[2]);
  }

  protected override ref(text: string): string | undefined {
    return text.match(RECEIPT)?.[1];
  }
}
