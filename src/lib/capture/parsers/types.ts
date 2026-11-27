// Shapes every capture parser returns. Kept apart from the parsers so a bank
// parser, the generic fallback and ingest all share one definition.

export const PARSER_VERSION = 5;
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
  /** The account's balance the message prints ("Avl Bal Rs.9,940.00"), in paise. Rupees only; left out when it is
   * masked, negative, overdrawn ("Dr") or in another currency. Stored on the capture; not used yet (ticket 156). */
  balanceMinor?: number;
  /** A card's available limit the message prints ("Avl Lmt INR 1,02,340.00"), in paise. Same rules as the balance. */
  availableLimitMinor?: number;
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
