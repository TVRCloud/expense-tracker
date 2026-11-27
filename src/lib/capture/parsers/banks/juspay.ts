// Amazon Pay balance, whose messages come through Juspay: "Payment of Rs 366.85 using Apay Balance successful at
// SHOP. Updated Balance is Rs 1,137.15 - SMS by Juspay" or "Your Apay Wallet balance is debited for INR 91.35
// Transaction Reference Number is <ref> - Powered by Juspay". Only messages that name the Amazon Pay balance are read;
// the balance has no account number, so every read goes to Review.

import { AMT, AppParser } from "./app-shared";
import { cleanParty, NAME } from "./known";
import type { FoundAccount } from "../extract/account";
import type { MoneyParse } from "../types";

const BALANCE = /\bApay\s(?:Wallet\s)?balance\b|\bAmazon\sPay\s(?:balance|wallet)\b/i;

export class JuspayParser extends AppParser {
  readonly id = "juspay";
  readonly bankName = "Amazon Pay balance";
  override readonly senderIds = ["JUSPAY"];

  protected readonly shapes = [
    new RegExp(String.raw`^Your\sApay\sWallet\sbalance\sis\sdebited\sfor\s${AMT}\b`, "i"),
    new RegExp(String.raw`^Payment\sof\s${AMT}\susing\sApay\sBalance\ssuccessful\sat\s\S`, "i"),
  ];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    return BALANCE.test(text) ? super.parse(text, receivedAt) : null;
  }

  protected override account(): FoundAccount | null {
    return null;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const at = text.match(new RegExp(String.raw`\bsuccessful\sat\s${NAME}(?:\.\s|\.$|\s-\s|$)`, "i"));
    return cleanParty(at?.[1]) ?? (type === "income" ? super.merchant(text, type) : undefined);
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bReference\sNumber\s(?:is\s)?:?\s?(\d{6,22})\b/i)?.[1] ?? super.ref(text);
  }
}
