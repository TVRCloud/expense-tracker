// Bank of Baroda and BOBCARD. An account alert puts "Dr."/"Cr." right after the amount ("Rs.318.00 Dr. from A/c
// XX719628 …", "Rs.1,297.00 Cr. to anita@okicici A/c XX719628 …": money in, from that UPI id); a transfer names the
// account with dots ("from A/c ...7193 to:NAME."); an account number may show six digits ("XX719628", last four 9628);
// a card spend reads "spent on your BOBCARD ending 3381 at SHOP".

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import { cleanParty, KnownBankParser, NAME, sharedParty, verbAccount } from "./known";

const DR_CR = /(?:Rs\.?|INR|₹)\s?[\d,]{1,12}(?:\.\d{1,2})?\s(Dr|Cr)\.?\s/i;

export class BobParser extends KnownBankParser {
  readonly id = "bob";
  readonly bankName = "Bank of Baroda";
  override readonly senderIds = ["BOBSMS", "BOBTXN", "BOBCRD"];
  override readonly packageNames = ["com.bankofbaroda.mconnect"];

  protected readonly shapes = [
    /^Rs\.[\d,.]{1,15}\s(?:Dr|Cr)\.\s(?:from|to)\s/i,
    /^Rs\.[\d,.]{1,15}\stransferred\sfrom\sA\/c\s\.{2,4}\d{4}\sto:/i,
    /^Rs\.[\d,.]{1,15}\scredited\sto\sA\/c\sX{1,8}\d{4,8}\svia\s/i,
    /\bspent\son\syour\sBOBCARD\sending\s\d{4}\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    const drCr = text.match(DR_CR);
    if (drCr) return { type: drCr[1].toLowerCase() === "dr" ? "expense" : "income", ambiguous: false };
    return super.direction(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Two accounts in one message: the one next to the verb that matches the direction (ticket 156).
    const moved = verbAccount(text, type);
    if (moved) return moved;
    const card = text.match(/\bBOBCARD\sending\s(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    const acct = text.match(/(?<!\b(?:loan|card)\s)\bA\/c\s(?:\.{2,4}|[X*]{1,8})\d{0,8}?(\d{4})\b/i);
    if (acct) return { last4: acct[1], instrument: "account" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (/\bdeposited\sin\scash\b/i.test(text)) return undefined;
    const toColon = text.match(new RegExp(String.raw`\bto:\s?${NAME}\.(?:\s|$)`, "i"));
    const crTo = text.match(/\bCr\.\sto\s([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i);
    return cleanParty(toColon?.[1]) ?? crTo?.[1] ?? sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bRef:\s?(\d{6,16})\b/i)?.[1] ?? text.match(/\bIMPS\/(\d{12})\b/)?.[1] ?? super.ref(text);
  }
}
