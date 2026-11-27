// PhonePe wallet. Only messages about the wallet itself are read ("You've paid Rs.48.00 via PhonePe wallet for
// SHOP."): a PhonePe UPI payment leaves the person's bank account, whose own message already records it, so anything
// that does not name the wallet goes to the generic parser as before. A wallet has no account number, so every read
// goes to Review. Only the PHONPE SMS header is claimed: the PhonePe app's own notifications (UPI payments, fund
// purchases) keep reading through the shared rules, so claiming its package would change them.

import { AMT, AppParser } from "./app-shared";
import { cleanParty, NAME } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import type { MoneyParse } from "../types";

const WALLET = /\bPhonePe\swallet\b/i;

export class PhonePeWalletParser extends AppParser {
  readonly id = "phonepe_wallet";
  readonly bankName = "PhonePe wallet";
  override readonly senderIds = ["PHONPE"];

  protected readonly shapes = [
    new RegExp(String.raw`^You'?ve\spaid\s${AMT}\svia\sPhonePe\swallet\sfor\s\S`, "i"),
    new RegExp(String.raw`^${AMT}\s(?:has\sbeen\s)?(?:added|credited|refunded)\sto\syour\sPhonePe\swallet\b`, "i"),
  ];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    return WALLET.test(text) ? super.parse(text, receivedAt) : null;
  }

  /** Only the words before "PhonePe wallet" say which way the money went, so a shop with "REFUND" in its name after it
   * never turns a payment into income. */
  protected override direction(text: string): FoundDirection | null {
    const at = text.search(WALLET);
    const head = at > 0 ? text.slice(0, at) : "";
    if (/\b(?:paid|spent|debited|sent|used)\b/i.test(head)) return { type: "expense", ambiguous: false };
    if (/\b(?:added|credited|refunded|received)\b/i.test(head)) return { type: "income", ambiguous: false };
    return null;
  }

  protected override account(): FoundAccount | null {
    return null;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (type !== "expense") return undefined;
    return cleanParty(text.match(new RegExp(String.raw`\bvia\sPhonePe\swallet\sfor\s${NAME}(?:\.\s|\.$|$)`, "i"))?.[1]);
  }
}
