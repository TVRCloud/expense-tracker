// Shapes every capture parser returns. Kept apart from the parsers so a bank
// parser, the generic fallback and ingest all share one definition.

export const PARSER_VERSION = 3;
export const CONFIDENCE_AUTO_CREATE = 0.8;

/** Where a message came from: the SMS sender id ("VM-HDFCBK") or, for a notification, the app label and package. */
export interface MessageSource {
  sender?: string | null;
  packageName?: string | null;
}

export interface MoneyParse {
  kind: "money";
  parserId: string;
  confidence: number;
  type: "income" | "expense";
  /** Minor units of [currency] (paise for INR, cents for USD). */
  amountMinor: number;
  /** INR for almost every message; a card spend abroad keeps the currency it was charged in. */
  currency: string;
  last4?: string;
  instrument?: "card" | "account";
  merchant?: string;
  ref?: string;
  bankName?: string;
  date?: Date;
  hasTime: boolean;
  /** A cash withdrawal at an ATM (expense only). Ingest turns it into a transfer to the cash account. */
  atm?: true;
  /** Money paid to a credit card bill ("payment received towards your credit card"). Never auto-created. */
  cardPayment?: true;
}

export interface LoanEmiParse {
  kind: "loan_emi_payment";
  parserId: string;
  confidence: number;
  amountMinor: number;
  currency: "INR";
  lenderName: string;
  externalLoanId: string;
  period?: string;
}

export interface IgnoredParse {
  kind: "ignored";
  parserId: "ignore";
  confidence: 1;
  reason: "otp" | "promo" | "reminder" | "not_financial";
}

export interface UnknownParse {
  kind: "unknown";
  parserId: "none";
  confidence: 0;
}

export type CaptureParse = MoneyParse | LoanEmiParse | IgnoredParse | UnknownParse;
