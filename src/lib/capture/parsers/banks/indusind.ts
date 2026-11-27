// IndusInd Bank. A UPI debit names the payee after "towards" ("debited by Rs X towards <UPI id>"); an account is
// often written with its first digits shown and the middle masked ("A/C 201***046152", "Account 15XXXXX6152"); an
// ACH debit names the payee after the last "/" before ".Bal"; deposit interest is "paid on your ... Deposit": money
// in, not out.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, KnownBankParser, sharedParty } from "./known";

const DEPOSIT_INTEREST = /\binterest\s(?:INR|Rs\.?)\s?[\d,.]{1,15}\spaid\son\syour\s[^.]{0,30}?\bDeposit\b/i;

export class IndusIndParser extends KnownBankParser {
  readonly id = "indusind";
  readonly bankName = "IndusInd Bank";
  override readonly senderIds = ["INDUSB"];

  protected readonly shapes = [
    /^A\/c\s\*?XX\d{4}\s(?:debited|credited)\sby\sRs\.?\s?[\d,.]{1,15}\s(?:towards|from)\s/i,
    /\bspent\son\sIndusInd\sCard\sXX\d{4}\son\s/i,
    /\bdebited\sfrom\syour\sA\/C\s\d{2,4}\*{2,}\d{4,8}\stowards\sDebit\sCard\sPurchase\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    if (DEPOSIT_INTEREST.test(text)) return { type: "income", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // "A/C 201***046152", "Account 15XXXXX6152": the last four digits of a partly shown number.
    const partly = text.match(/(?<!\b(?:loan|card|deposit)\s)\b(?:A\/C|Account)\s(?:no\.?\s)?\d{1,4}[X*]{2,10}\d{0,4}?(\d{4})\b/i);
    if (partly) return { last4: partly[1], instrument: "account" };
    const card = text.match(/\bIndusInd\s(?:Credit\s|Debit\s)?Card\sXX(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    if (DEPOSIT_INTEREST.test(text)) return null;
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (DEPOSIT_INTEREST.test(text) || /\btowards\sDebit\sCard\sPurchase\b/i.test(text)) return undefined;
    const towards = text.match(/\btowards\s([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i);
    const ach = text.match(/\bACH\sDR\b[^.]{0,80}\/([A-Za-z][A-Za-z0-9 &]{1,40})\.\s?Bal\b/i);
    return towards?.[1] ?? cleanParty(ach?.[1]) ?? sharedParty(super.merchant(text, type));
  }
}
