// Bank of India. A UPI debit names both sides in one sentence ("Rs.418.00 debited A/cXX2846 and credited to NAME via
// UPI Ref No …"): money out of the person's account, the payee after "credited to". A credit or a cash deposit starts
// "BOI - Rs …"; a NEFT credit names the sender after the IFSC ("By NEFTINWARD <code>/NAME .Avl Bal …"); a cash deposit
// machine is never the payer.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, NAME, sharedParty, verbAccount } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

const DEBIT_AND_CREDIT_TO = /\bdebited\sA\/c\s?XX\d{4}\sand\scredited\sto\s/i;

export class BoiParser extends PublicSectorParser {
  readonly id = "boi";
  readonly bankName = "Bank of India";
  override readonly senderIds = ["BOIIND", "BOIBNK"];

  protected readonly shapes = [
    /^Rs\.[\d,.]{1,15}\sdebited\sA\/c\s?XX\d{4}\sand\scredited\sto\s/i,
    /^BOI\s-\s(?:Cash\s)?Rs\.?\s?[\d,.]{1,15}\s(?:Credited|Debited|deposited)\s/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    // The payee is credited, the person's account debited: money out, and not an unsure read.
    // Not when it has been reversed or refunded: then the shared rules (and Review) decide.
    if (DEBIT_AND_CREDIT_TO.test(text) && !/\b(?:revers(?:al|ed)|refund(?:ed)?)\b/i.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Two accounts in one message: the one next to the verb that matches the direction (ticket 156).
    const moved = verbAccount(text, type);
    if (moved) return moved;
    const acct = text.match(/(?<!\b(?:loan|card)\s)\b(?:A\/c|Ac|account)\s?XX(\d{4})\b/i);
    return acct ? { last4: acct[1], instrument: "account" } : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (/\bCash\sAcceptor\b/i.test(text)) return undefined;
    const payee = text.match(new RegExp(String.raw`\band\scredited\sto\s${NAME}\svia\b`, "i"));
    const neft = text.match(/\bBy\sNEFTINWARD\s[A-Za-z0-9]{1,30}\/([^./]{1,60}?)\s?\./i);
    if (payee || neft) return nameOnly(payee?.[1] ?? neft?.[1]);
    return nameOnly(sharedParty(super.merchant(text, type)));
  }
}
