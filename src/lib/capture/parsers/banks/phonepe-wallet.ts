// PhonePe wallet. Only messages about the wallet itself are read ("You've paid Rs.48.70 via PhonePe wallet for
// SHOP."): a PhonePe UPI payment leaves the person's bank account, whose own message already records it, so anything
// that does not name the wallet goes to the generic parser as before. A wallet has no account number, so every read
// goes to Review. Only the PHONPE SMS header is claimed: the PhonePe app's own notifications (UPI payments, fund
// purchases) keep reading through the shared rules, so claiming its package would change them.

import { AMT, AppParser, YOUVE } from "./app-shared";
import { cleanParty, NAME, sharedParty } from "./known";
import type { FoundAccount } from "../extract/account";
import type { FoundAmount } from "../extract/amount";
import type { FoundDirection } from "../extract/direction";
import type { MoneyParse } from "../types";

const WALLET = /\bPhonePe\swallet\b/i;

/** The sentence that names the wallet ("You've paid Rs.48 to SHOP. Cashback of Rs.5 credited to your PhonePe
 * wallet." gives the second one): its amount, verb and payee are the wallet's; another sentence may be about other
 * money. A "." in "Rs." or inside an amount does not end a sentence. */
function walletSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.split(/(?<!\b(?:Rs|no))\.\s+(?=[A-Z])/).find((s) => WALLET.test(s)) ?? flat;
}

export class PhonePeWalletParser extends AppParser {
  readonly id = "phonepe_wallet";
  readonly bankName = "PhonePe wallet";
  override readonly senderIds = ["PHONPE"];

  protected readonly shapes = [
    new RegExp(String.raw`^${YOUVE}\spaid\s${AMT}\svia\sPhonePe\swallet\sfor\s\S`, "i"),
    new RegExp(String.raw`^${AMT}\s(?:has\sbeen\s)?(?:added|credited|refunded)\sto\syour\sPhonePe\swallet\b`, "i"),
  ];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    return WALLET.test(text) ? super.parse(text, receivedAt) : null;
  }

  protected override amount(text: string): FoundAmount | null {
    return super.amount(walletSentence(text));
  }

  /** Only the words before "PhonePe wallet", in its own sentence, say which way the money went, so a shop with "REFUND" in its name after
   * it never turns a payment into income. Money coming back is tested first: "Rs.62 paid to RIDES was refunded to your
   * PhonePe wallet" is a refund. */
  protected override direction(text: string): FoundDirection | null {
    const sentence = walletSentence(text);
    const at = sentence.search(WALLET);
    const head = at > 0 ? sentence.slice(0, at) : "";
    if (/\b(?:added|credited|refunded|reversed|received)\b/i.test(head)) return { type: "income", ambiguous: false };
    if (/\b(?:paid|spent|debited|sent|used)\b/i.test(head)) return { type: "expense", ambiguous: false };
    return null;
  }

  protected override account(): FoundAccount | null {
    return null;
  }

  protected override merchant(full: string, type: "income" | "expense"): string | undefined {
    const text = walletSentence(full);
    if (type === "expense") {
      return cleanParty(text.match(new RegExp(String.raw`\bvia\sPhonePe\swallet\sfor\s${NAME}(?:\.\s|\.$|$)`, "i"))?.[1]);
    }
    // A refund names who paid it back ("paid to RIDES was refunded", "refund from RIDES").
    const back = text.match(new RegExp(String.raw`\b(?:paid\sto|from)\s${NAME}\s(?:was\s|has\sbeen\s)?(?:refunded|reversed|credited)\b`, "i"));
    return cleanParty(back?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
