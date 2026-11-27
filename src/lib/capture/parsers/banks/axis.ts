// Axis Bank. A card alert often has no "at": the shop sits between the time and "Avl Limit" ("Spent INR 250 Axis
// Bank Card no. XX1234 12-11-26 10:15:00 IST SHOP NAME Avl Limit: ..."); a debit names the account with more than four
// digits ("A/c no. XX123456"), and a UPI alert carries "UPI/P2M/<ref>/<payee>". The "SMS BLOCKCARD XX1234" line names
// a debit card, never the account.

import type { FoundAccount } from "../extract/account";
import { cleanParty, KnownBankParser, sharedParty } from "./known";

const UPI_PATH = /\bUPI\/P2[AM]\/(\d{6,22})\/([^/]+?)(?:\/|\s+Not\s+you|\.(?:\s|$)|$)/i;

export class AxisParser extends KnownBankParser {
  readonly id = "axis";
  readonly bankName = "Axis Bank";
  override readonly senderIds = ["AXISBK"];
  override readonly packageNames = ["com.axis.mobile"];

  protected readonly shapes = [
    /^Spent\s+(?:INR\s+[\d,.]+\s+(?:using\s+)?Axis\s+Bank\s+(?:Credit\s+)?Card\s+no\.\s*XX\d{4}|Card\s+no\.\s*XX\d{4}\s+INR\s+[\d,.]+)/i,
    /\b(?:debited\s+from|credited\s+to)\s+A\/c\s+no\.\s*XX\d{4,}\b.*\bAxis\s+Bank\b/i,
    /\bA\/c\s+no\.\s*XX\d{4,}\b.*\bUPI\/P2[AM]\/\d+\//i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const acct = text.match(/\bA\/c\s+no\.?\s*[X*]*(\d{4,})\b/i);
    if (acct) return { last4: acct[1].slice(-4), instrument: "account" };
    // The account is masked out entirely ("A/c no. XXxxxx"): no digits, rather than the BLOCKCARD card's.
    if (/\bA\/c\s+no\.?\s*[X*x]+[a-z]*\b/i.test(text)) return null;
    const card = text.match(/\bCard\s+no\.?\s*[X*]*(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const upi = text.match(UPI_PATH);
    const afterTime = text.match(/\d{2}:\d{2}:\d{2}(?:\s+IST)?\s+(.+?)\s+Avl\s+(?:Limit|Lmt)\b/i);
    const onBeforeDate = text.match(/\bA\/c\s+no\.?\s*\S+\s+on\s+(.+?)\s+\d{2}-\d{2}-\d{2,4}\b/i);
    return cleanParty(upi?.[2]) ?? cleanParty(afterTime?.[1]) ?? cleanParty(onBeforeDate?.[1]) ?? sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(UPI_PATH)?.[1] ?? super.ref(text);
  }
}
