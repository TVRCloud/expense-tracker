// Shapes every capture parser returns. Kept apart from the parsers so a bank
// parser, the generic fallback and ingest all share one definition.

export const PARSER_VERSION = 6;
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

/** A mandate (UPI AutoPay, e-mandate, NACH, standing instruction) set up, changed, paused, resumed or revoked. No money
 * moved: ingest stores it with reason "mandate", never as a transaction and never in Review (ticket 157). A debit made
 * under a mandate is a normal money parse. */
export interface MandateParse {
  kind: "mandate";
  parserId: "mandate";
  confidence: number;
  event: "created" | "modified" | "revoked" | "paused" | "resumed";
  merchant?: string;
  /** The most the mandate may take each time, in paise (INR only). */
  maxAmountMinor?: number;
  /** "monthly", "weekly", "yearly", "as presented" ... as printed, lower case. */
  frequency?: string;
  bankName?: string;
  last4?: string;
  startDate?: Date;
  validUntil?: Date;
}

/** A fund house or registrar's message about a mutual fund SIP, purchase, unit allotment, redemption or switch.
 * Information only: the bank sends its own debit or credit, so booking this too would count the money twice. Stored
 * with reason "investment" (ticket 157). Units and NAV stay strings as printed; money is in paise. */
export interface InvestmentParse {
  kind: "investment";
  parserId: "investment";
  confidence: number;
  event: "sip" | "purchase" | "allotment" | "redemption" | "switch";
  fundName?: string;
  amountMinor?: number;
  units?: string;
  nav?: string;
  /** Last four digits of the folio only, never the whole number. */
  folioLast4?: string;
  date?: Date;
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

export type CaptureParse = MoneyParse | LoanEmiParse | MandateParse | InvestmentParse | IgnoredParse | UnknownParse;
