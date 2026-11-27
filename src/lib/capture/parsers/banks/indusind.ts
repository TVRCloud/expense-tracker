// IndusInd Bank. A UPI debit names the payee after "towards" ("debited by Rs X towards <UPI id>"); an account is
// often written with its first digits shown and the middle masked ("A/C 201***046152", "Account 15XXXXX6152"); an
// ACH debit names the payee after the last "/" before ".Bal"; deposit interest is "paid on your ... Deposit": money
// in, not out.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, sharedParty } from "./known";
import { hasMaskedNumber, scrubParty } from "./party-scrub";
import { PrivateBankParser } from "./private-base";

const DEPOSIT_INTEREST = /\binterest\s(?:INR|Rs\.?)\s?[\d,.]{1,15}\spaid\son\syour\s[^.]{0,30}?\bDeposit\b/i;
// Tax taken from deposit interest is money out, never interest paid in.
const TAX = /\bTDS\b|\bdeducted\b/i;
// Money moved into the person's own RD, FD or deposit from their savings account: out of the savings account.
const FUNDS_DEPOSIT =
  /\b(?:RD|FD|Deposit)\s(?:A\/C|Account)\s[\dX*]{4,20}\s(?:has\sbeen\s|is\s)?credited\b|\bcredited\sto\s(?:your\s)?(?:RD|FD|Deposit)\b/i;
const FROM_SAVINGS = /\bby\sdebit\s(?:to|from)\s(?:your\s)?A\/C\b|\bfrom\s(?:your\s)?A\/C\s\d{0,4}[X*]{2,10}\d{2,8}\b/i;
// An account written in full or partly shown ("A/C 159***007731", "Account 15XXXXX7731"), with the word before it.
const MASKED_ACCOUNT = /(\b[A-Za-z]{2,8}\s)?(?:A\/C|Account)\s(?:no\.?\s)?(\d{1,4}[X*]{2,10}\d{0,4}?(\d{4}))\b/gi;
// Not the person's own spending account: a loan, card, deposit, RD or FD.
const NOT_OWN = /^(?:loan|card|deposit|FD|RD)\s$/i;
const OWN = /^your\s$/i;
// A card named in a message that also says which account money left or reached is only what it was for.
const ACCOUNT_MOVED = /\b(?:debited\sfrom|credited\sto)\s(?:your\s)?(?:a\/c|acct|account)\b/i;

export class IndusIndParser extends PrivateBankParser {
  readonly id = "indusind";
  readonly bankName = "IndusInd Bank";
  override readonly senderIds = ["INDUSB"];

  protected readonly shapes = [
    /^A\/c\s\*?XX\d{4}\s(?:debited|credited)\sby\sRs\.?\s?[\d,.]{1,15}\s(?:towards|from)\s/i,
    /\bspent\son\sIndusInd\sCard\sXX\d{4}\son\s/i,
    /\bdebited\sfrom\syour\sA\/C\s\d{2,4}\*{2,}\d{4,8}\stowards\sDebit\sCard\sPurchase\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    if (DEPOSIT_INTEREST.test(text) && !TAX.test(text)) return { type: "income", ambiguous: false };
    if (FUNDS_DEPOSIT.test(text) && FROM_SAVINGS.test(text)) return { type: "expense", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // "A/C 201***046152", "Account 15XXXXX6152": the last four digits of a partly shown number. Never a loan, card,
    // deposit, RD or FD account; with two left, only the one written "your A/C".
    const masks = [...text.matchAll(MASKED_ACCOUNT)].filter((m) => !NOT_OWN.test(m[1] ?? ""));
    if (masks.length > 0) {
      const own = masks.length === 1 ? masks : masks.filter((m) => OWN.test(m[1] ?? ""));
      return own.length === 1 ? { last4: own[0][3], instrument: "account" } : null;
    }
    if (DEPOSIT_INTEREST.test(text)) return null;
    const card = ACCOUNT_MOVED.test(text) ? null : text.match(/\bIndusInd\s(?:Credit\s|Debit\s)?Card\sXX(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (DEPOSIT_INTEREST.test(text) || /\btowards\sDebit\sCard\sPurchase\b/i.test(text)) return undefined;
    const towards = text.match(/\btowards\s([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i);
    const ach = text.match(/\bACH\sDR\b[^.]{0,80}\/([A-Za-z][A-Za-z0-9 &]{1,40})\.\s?Bal\b/i);
    const shared = sharedParty(super.merchant(text, type));
    // "towards FD closure 410***551203": a name built around an account number is no payee at all.
    return towards?.[1] ?? scrubParty(cleanParty(ach?.[1])) ?? (hasMaskedNumber(shared) ? undefined : scrubParty(shared));
  }
}
