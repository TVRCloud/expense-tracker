// YES BANK. A card spend names the shop after "@" (with "UPI_" in front when paid through UPI) and before the date:
// "INR X spent on YES BANK Card X1234 @UPI_SHOP NAME 04-10-2026 09:12:44 am. Avl Lmt INR Y".

import type { FoundAccount } from "../extract/account";
import { cleanParty, sharedParty } from "./known";
import { PrivateBankParser } from "./private-base";

export class YesParser extends PrivateBankParser {
  readonly id = "yes";
  readonly bankName = "YES BANK";
  override readonly senderIds = ["YESBNK"];

  protected readonly shapes = [/\bspent\son\sYES\sBANK\sCard\sX{1,4}\d{4}\s@/i];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // The account the money left or reached wins over a card the message only mentions ("for YES BANK Debit Card
    // X5577 annual fee").
    const accountMoved = /\b(?:debited\sfrom|credited\sto)\s(?:your\s)?(?:a\/c|acct|account)(?:\sno\.?)?\s?\*?[x*\d]/i.test(text);
    const card = accountMoved ? null : text.match(/\bYES\sBANK\s(?:Credit\s|Debit\s)?Card\sX{1,4}(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const at = text.match(/\bCard\sX{1,4}\d{4}\s@(?:UPI_)?(\S[^@.;]{0,58}?)\s\d{1,2}-\d{1,2}-\d{2,4}\b/i);
    return cleanParty(at?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
