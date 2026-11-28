// Axis Bank. A card alert often has no "at": the shop sits between the time and "Avl Limit" ("Spent INR 75 Axis Bank
// Card no. XX2208 03-10-26 08:12:40 IST SHOP NAME Avl Limit: ..."); a debit names the account with more than four
// digits ("A/c no. XX550917"); a UPI alert carries "UPI/P2M/<ref>/<payee>". The "SMS BLOCKCARD XX2208" line names a
// debit card, never the account.

import type { FoundAccount } from "../extract/account";
import { cleanParty, KnownBankParser, NAME, railParty, sharedParty } from "./known";

const UPI_PATH = /\bUPI\/P2[AM]\/(\d{6,22})\/([^/]{1,60}?)(?:\/|\sNot\syou|\.(?:\s|$)|$)/i;

export class AxisParser extends KnownBankParser {
  readonly id = "axis";
  readonly bankName = "Axis Bank";
  override readonly senderIds = ["AXISBK"];
  override readonly packageNames = ["com.axis.mobile"];

  protected readonly shapes = [
    /^Spent\s(?:INR\s[\d,.]{1,15}\s(?:using\s)?Axis\sBank\s(?:Credit\s)?Card\sno\.\s?XX\d{4}|Card\sno\.\s?XX\d{4}\sINR\s[\d,.]{1,15})/i,
    /\b(?:debited\sfrom|credited\sto)\sA\/c\sno\.\s?XX\d{4,8}\b[^]{0,200}\bAxis\sBank\b/i,
    /\bA\/c\sno\.\s?XX\d{4,8}\b[^]{0,80}\bUPI\/P2[AM]\/\d{6,22}\//i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const acct = text.match(/(?<!\b(?:loan|card)\s)\bA\/c\sno\.?\s?[X*]{0,8}(\d{4,12})\b/i);
    if (acct) return { last4: acct[1].slice(-4), instrument: "account" };
    // The account is masked out entirely ("A/c no. XXxxxx"): no digits, rather than the BLOCKCARD card's.
    if (/(?<!\b(?:loan|card)\s)\bA\/c\sno\.?\s?[X*x]{1,12}[a-z]{0,6}\b/i.test(text)) return null;
    const card = text.match(/\bCard\sno\.?\s?[X*]{0,8}(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const upi = text.match(UPI_PATH);
    const afterTime = text.match(new RegExp(String.raw`\d{2}:\d{2}:\d{2}(?:\sIST)?\s${NAME}\sAvl\s(?:Limit|Lmt)\b`, "i"));
    const onBeforeDate = text.match(new RegExp(String.raw`\bA\/c\sno\.?\s?\S{1,14}\son\s${NAME}\s\d{2}-\d{2}-\d{2,4}\b`, "i"));
    const info = text.match(/\bInfo[\s:\-]{0,3}([^.]{1,80}?)(?:\.(?=\s|$)|$)/);
    return (
      cleanParty(upi?.[2]) ??
      cleanParty(afterTime?.[1]) ??
      cleanParty(onBeforeDate?.[1]) ??
      railParty(info?.[1]) ??
      sharedParty(super.merchant(text, type))
    );
  }

  protected override ref(text: string): string | undefined {
    return text.match(UPI_PATH)?.[1] ?? super.ref(text);
  }
}
