import { MONTH_PATTERN, parseMessageDate } from "./dates";

// Turns bank / UPI message text (SMS or app notification) into structured
// data. Lives in the codebase, not in n8n or the phone, so every capture
// source shares one versioned, tested parser.
//
// Order matters: messages that must never become transactions (OTPs,
// offers, due reminders) are filtered first, then the exact known formats,
// then a generic parser for the common Indian bank phrasing. Every result
// carries a confidence from 0 to 1; ingest only auto-creates a transaction
// at CONFIDENCE_AUTO_CREATE or above and queues the rest for review.

export const PARSER_VERSION = 2;
export const CONFIDENCE_AUTO_CREATE = 0.8;

export interface MoneyParse {
  kind: "money";
  parserId: string;
  confidence: number;
  type: "income" | "expense";
  amountMinor: number; // paise
  currency: "INR";
  last4?: string;
  instrument?: "card" | "account";
  merchant?: string;
  ref?: string;
  bankName?: string;
  date?: Date;
  hasTime: boolean;
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

const AMOUNT = String.raw`(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)`;
const DEBIT_WORDS = /\b(debited|spent|paid|sent|withdrawn|withdrawal|purchase|transferred|deducted|payment of|txn of|used)\b/i;
const CREDIT_WORDS = /\b(credited|received|deposited|refund(?:ed)?|reversed|cashback of)\b/i;

/** "3,980" / "896.15" -> 398000 / 89615 (paise). */
export function toMinorUnits(amountText: string): number {
  return Math.round(Number.parseFloat(amountText.replace(/,/g, "")) * 100);
}

function ignoreReason(text: string): IgnoredParse["reason"] | null {
  if (/\bOTP\b|one[\s-]?time\s+pass(word|code)|verification code|\bcode is\b/i.test(text)) return "otp";
  const hasMovement = DEBIT_WORDS.test(text) || CREDIT_WORDS.test(text);
  if (
    /\b(requested|collect request|request of)\b/i.test(text) &&
    !/\b(debited|credited)\b/i.test(text)
  ) {
    return "not_financial";
  }
  if (
    /\b(is due|due on|due date|due by|minimum amount due|min\.? amt due|total amount due|bill (is )?generated|statement (is )?generated)\b/i.test(text) &&
    !/\b(debited|spent|credited|received)\b/i.test(text)
  ) {
    return "reminder";
  }
  if (
    /\b(pre-?approved|offer|apply now|click here|limited time|win|voucher|upgrade)\b/i.test(text) &&
    !hasMovement
  ) {
    return "promo";
  }
  return null;
}

// "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi
// Finserv loan account 010021753351 for October 2026."
function parseLoanEmi(text: string): LoanEmiParse | null {
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
function parseIdfcCardSpend(text: string, receivedAt: Date): MoneyParse | null {
  const match = text.match(
    new RegExp(
      `INR\\s*([\\d,]+(?:\\.\\d+)?)\\s*spent on your\\s+(.+?)\\s+Credit Card ending\\s*(?:XX)?(\\d{4})\\s+at\\s+(.+?)\\s+on\\s+(\\d{1,2}\\s+(?:${MONTH_PATTERN})\\s+\\d{4})`,
      "i"
    )
  );
  if (!match) return null;
  const [, amountText, bankName, last4, merchant] = match;
  const parsedDate = parseMessageDate(text, receivedAt);
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
  };
}

/** First amount in the text that isn't a balance or limit figure. */
function findAmount(text: string): { minor: number; index: number } | null {
  const withCurrency = findCurrencyAmount(text);
  if (withCurrency) return withCurrency;
  // SBI-style, no currency token: "A/c X1234 debited by 250.0 on date 26Sep26"
  const bare = text.match(/\b(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d{1,2})?)\b/i);
  if (bare) {
    const minor = toMinorUnits(bare[1]);
    if (minor > 0) return { minor, index: bare.index ?? 0 };
  }
  return null;
}

function findCurrencyAmount(text: string): { minor: number; index: number } | null {
  const re = new RegExp(AMOUNT, "gi");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 22), m.index);
    if (/(bal(ance)?|limit|avl|avbl|available|outstanding|due)[\s:.-]*(is|of)?[\s:.-]*$/i.test(before)) continue;
    const minor = toMinorUnits(m[1]);
    if (minor > 0) return { minor, index: m.index };
  }
  return null;
}

function findDirection(text: string): { type: "income" | "expense"; ambiguous: boolean } | null {
  const debit = text.search(DEBIT_WORDS);
  const credit = text.search(CREDIT_WORDS);
  if (debit === -1 && credit === -1) return null;
  if (debit === -1) return { type: "income", ambiguous: false };
  if (credit === -1) return { type: "expense", ambiguous: false };
  // Both appear ("debited from your a/c ... credited to VPA x"): the first
  // verb is about the account holder's own account.
  return { type: debit < credit ? "expense" : "income", ambiguous: true };
}

function findLast4(text: string): { last4: string; instrument: "card" | "account" } | null {
  const match = text.match(
    /\b(a\/c|acct|account|card|a\/c no\.?|ac)\b[^\d]{0,24}?(?:[x*]+|ending(?:\s+with)?\s*[x*]*|no\.?\s*[x*]*)\s*(\d{4})\b/i
  );
  if (match) {
    return { last4: match[2], instrument: /card/i.test(match[1]) ? "card" : "account" };
  }
  const bare = text.match(/\b[xX*]{2,}(\d{4})\b/);
  if (bare) return { last4: bare[1], instrument: /card/i.test(text) ? "card" : "account" };
  return null;
}

function findRef(text: string): string | undefined {
  const match = text.match(
    /\b(?:UPI\s*Ref(?:\.|erence)?(?:\s*No)?|Ref(?:erence)?\.?\s*(?:No|Number|ID)?|RRN|UTR|Txn\s*(?:ID|No)|IMPS\s*Ref)[\s:.#-]*([A-Za-z0-9]{6,22})\b/i
  );
  return match?.[1];
}

const MERCHANT_RE =
  /\b(at|to|from|towards|by|VPA|Info:?|trf to|paid to)\s+([A-Za-z0-9@._&*'/ -]{2,40}?)(?=\s+(?:on|ref|refno|ref\.?\s*no|via|at|from|to|by|a\/c|acct|avl|avbl|upi|dt|date|\d{1,2}[-/])\b|[.,;(]|$)/gi;

/**
 * The other party. For a debit that's who was paid ("to", "at", "VPA"); for
 * a credit, who paid ("from", "by"). Candidates that are the account
 * holder's own account ("from HDFC Bank A/C *1234") are skipped.
 */
function findMerchant(text: string, type: "income" | "expense"): string | undefined {
  const preferred = type === "expense" ? /^(at|to|vpa|info|trf to|paid to|towards)/i : /^(from|by)/i;
  const candidates: { value: string; preferred: boolean }[] = [];
  for (const m of text.matchAll(MERCHANT_RE)) {
    let value = m[2].trim().replace(/^VPA\s+/i, "");
    const after = text.slice((m.index ?? 0) + m[0].length).trimStart();
    if (/^(a\/c|acct|account|card)\b/i.test(after)) continue;
    if (/^(your|you|a\/c|acct|account|neft|imps|rtgs|upi)\b/i.test(value)) continue;
    value = value.replace(/\s+(bank)$/i, " $1");
    candidates.push({ value, preferred: preferred.test(m[1]) });
  }
  return (candidates.find((c) => c.preferred) ?? candidates[0])?.value;
}

function findBankName(text: string): string | undefined {
  const match = text.match(
    /\b(HDFC|ICICI|SBI|Axis|Kotak|IDFC(?: FIRST)?|Yes|IndusInd|PNB|Bank of Baroda|BOB|Canara|Union|Federal|AU|RBL)\b\s*(Bank)?/i
  );
  return match ? `${match[1]}${match[2] ? " Bank" : ""}` : undefined;
}

// Covers the usual phrasing across HDFC, ICICI, SBI, Axis, Kotak, UPI apps:
//   "Rs.500.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678"
//   "Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 26/09/26 Ref 426912345678"
//   "INR 1,200.00 credited to your A/c No XX5678 on 26 Sep 2026 by NEFT from ACME PVT LTD"
//   "₹250 paid to Swiggy" (a UPI app notification: no account, lower confidence)
function parseGeneric(text: string, receivedAt: Date): MoneyParse | null {
  const amount = findAmount(text);
  const direction = findDirection(text);
  if (!amount || !direction) return null;

  const account = findLast4(text);
  const parsedDate = parseMessageDate(text, receivedAt);
  const ref = findRef(text);
  const merchant = findMerchant(text, direction.type);

  let confidence = 0.35 + 0.25; // amount + direction
  if (account) confidence += 0.25;
  if (parsedDate) confidence += 0.1;
  if (ref || merchant) confidence += 0.05;
  if (direction.ambiguous) confidence -= 0.15;

  return {
    kind: "money",
    parserId: "generic",
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    type: direction.type,
    amountMinor: amount.minor,
    currency: "INR",
    last4: account?.last4,
    instrument: account?.instrument,
    merchant,
    ref,
    bankName: findBankName(text),
    date: parsedDate?.date,
    hasTime: parsedDate?.hasTime ?? false,
  };
}

export function parseCapture(text: string, receivedAt: Date = new Date()): CaptureParse {
  const reason = ignoreReason(text);
  if (reason) return { kind: "ignored", parserId: "ignore", confidence: 1, reason };

  return (
    parseLoanEmi(text) ??
    parseIdfcCardSpend(text, receivedAt) ??
    parseGeneric(text, receivedAt) ?? { kind: "unknown", parserId: "none", confidence: 0 }
  );
}
