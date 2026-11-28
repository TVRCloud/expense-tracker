// Exact message shapes recognised by their wording, whatever the sender. They run before the sender's bank parser,
// so a bank parser never reads a loan EMI as plain income.

import { MONTH_PATTERN, parseMessageDate } from "./dates";
import { toMinorUnits } from "./extract/amount";
import { findAvailableLimit } from "./extract/balance";
import type { LoanEmiParse, MoneyParse } from "./types";

// "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi
// Finserv loan account 010021753351 for October 2026."
export function parseLoanEmi(text: string): LoanEmiParse | null {
  const match = text.match(
    /Rs\.?\s*([\d,]+(?:\.\d+)?)\s*\/?-?\s+received towards\s+(.+?)\s+loan account\s+(\w+)(?:\s+for\s+([A-Za-z]+ \d{4}))?/i
  );
  if (!match) return null;
  const [, amountText, lenderName, externalLoanId, period] = match;
  return {
    kind: "loan_emi_payment",
    parserId: "navi_emi",
    confidence: 0.95,
    amountMinor: toMinorUnits(amountText),
    currency: "INR",
    lenderName: lenderName.trim(),
    externalLoanId,
    period: period?.trim(),
  };
}

// "Happy Shopping! INR 896.15 spent on your IDFC FIRST Bank Credit Card
// ending XX1832 at PAYPAL *XINDAWNCOMP on 24 JUN 2026 at 04:04 PM ..."
export function parseIdfcCardSpend(text: string, receivedAt: Date): MoneyParse | null {
  const match = text.match(
    new RegExp(
      `INR\\s*([\\d,]+(?:\\.\\d+)?)\\s*spent on your\\s+(.+?)\\s+Credit Card ending\\s*(?:XX)?(\\d{4})\\s+at\\s+(.+?)\\s+on\\s+(\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s+\\d{4})`,
      "i"
    )
  );
  if (!match) return null;
  const [, amountText, bankName, last4, merchant] = match;
  const parsedDate = parseMessageDate(text, receivedAt);
  const limit = findAvailableLimit(text);
  return {
    kind: "money",
    parserId: "idfc_card_spend",
    confidence: parsedDate ? 0.97 : 0.85,
    type: "expense",
    amountMinor: toMinorUnits(amountText),
    currency: "INR",
    last4,
    instrument: "card",
    merchant: merchant.trim(),
    bankName: bankName.trim(),
    date: parsedDate?.date,
    hasTime: parsedDate?.hasTime ?? false,
    ...(limit !== undefined ? { availableLimitMinor: limit } : {}),
  };
}
