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

export const PARSER_VERSION = 3;
export const CONFIDENCE_AUTO_CREATE = 0.8;

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

// Rupees, plus the currencies a card is most often charged in abroad. All of these have two decimals, so the
// figure times 100 is its minor units.
const FOREIGN = "USD|EUR|GBP|AED|SGD|AUD|CAD|CHF|HKD|NZD|SAR|QAR|THB|MYR";
const AMOUNT = String.raw`(?:(Rs\.?|INR|₹|${FOREIGN}|US\$|\$|€|£)\s*([\d,]+(?:\.\d{1,2})?))`;
// "debit" as a noun only in SBI's "has a debit by transfer" (a plain "debit of Rs 499 is scheduled" is a notice, not
// money that moved); Dr / Cr only right before an amount.
// "will be debited", "scheduled to be debited": a notice, never a debit.
const DEBIT_WORDS =
  /(?<!\b(?:will|to|shall)\s+be\s+)\b(debited|debit(?=\s+by\s+transfer)|spent|paid|sent|withdrawn|withdrawal|wdl|purchase|transferred|deducted|payment of|txn of|used|dr(?=\.?\s*(?:Rs|INR|₹|\d)))\b/i;
const CREDIT_WORDS = /(?<!\b(?:will|to|shall)\s+be\s+)\b(credited|(?<!\b(?:request|mandate)\s+(?:has\s+been\s+|is\s+|was\s+)?)received|deposited|refund(?:ed)?|reversed|cashback of|cr(?=\.?\s*(?:Rs|INR|₹|\d)))\b/i;

/** A fraud warning many alerts end with ("Never share OTP/PIN with anyone"). Removed before the OTP check, so a
 * real debit that carries it is not thrown away as an OTP. Same rule as the phone's `CaptureFilter.OTP_WARNING`. */
const OTP_WARNING =
  /(?:\bdo\s*n[o'\u2019]?t|\bdon[\u2019']t|\bnever|\bnot|\bbeware|\bbanks?\s+never)\s+(?:to\s+)?(?:share|ask|disclose|reveal|give|tell)[^.\n\d]*/gi;

/** Currency symbol or code as written -> ISO code. */
function currencyOf(token: string): string {
  const t = token.toUpperCase().replace(/\.$/, "");
  if (t === "RS" || t === "INR" || t === "₹") return "INR";
  if (t === "US$" || t === "$") return "USD";
  if (t === "€") return "EUR";
  if (t === "£") return "GBP";
  return t;
}

/** "3,980" / "896.15" -> 398000 / 89615 (paise). */
export function toMinorUnits(amountText: string): number {
  return Math.round(Number.parseFloat(amountText.replace(/,/g, "")) * 100);
}

function ignoreReason(text: string): IgnoredParse["reason"] | null {
  // The warning is cut only up to the first digit, and a 4 to 8 digit code right after "OTP" (or "123456 is your
  // OTP") is always an OTP: "Don't share this OTP 123456 for txn of Rs 500" stays ignored. A merchant's "Auth code" or
  // "Approval code" is not an OTP.
  if (
    /\b(?:OTP|(?:verification|security|secret|one[\s-]?time)\s+code)\b\D{0,20}\b\d{4,8}\b|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:OTP|verification\s+code)\b/i.test(
      text
    )
  ) {
    return "otp";
  }
  if (/\bOTP\b|one[\s-]?time\s+pass(word|code)|verification code|\bcode is\b/i.test(text.replace(OTP_WARNING, " "))) {
    return "otp";
  }
  // Money that already moved: a past-tense debit or credit ("if debited" is a promise, not a debit).
  const moved =
    /(?<!\bif\s+(?:the\s+)?(?:amount\s+)?(?:is\s+|gets\s+)?|\b(?:will|to|shall)\s+be\s+|\b(?:request|mandate)\s+(?:has\s+been\s+|is\s+|was\s+)?)\b(debited|spent|deducted|withdrawn|wdl|sent|paid|transferred|received|deposited|credited|reversed|debit by transfer|has been refunded|is refunded|refunded to)\b/i.test(
      text
    );
  // A notice before a debit (RBI pre-debit and mandate alerts), or a debit that could not happen, moved nothing.
  // A pre-debit notification never moves money, whatever else it says ("mandate received on ...").
  if (/\bpre-?debit\b/i.test(text)) return "reminder";
  if (
    /\b(scheduled|(?:will|to) be (?:debited|credited|processed|deducted|charged|presented)|upcoming|insufficient (?:balance|funds))\b/i.test(text) &&
    !moved
  ) {
    return "reminder";
  }
  // A payment that did not go through moved no money. Only when nothing says money moved: "Rs 500 debited ...
  // UPI txn failed? Call 1800" is a real debit with a help line, and "Rs 799 reversed ... for failed UPI txn" a credit.
  if (/\b(failed|declined|unsuccessful|could not be (?:processed|completed)|has been rejected)\b/i.test(text) && !moved) {
    return "not_financial";
  }
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
function findAmount(text: string): { minor: number; index: number; currency: string } | null {
  const withCurrency = findCurrencyAmount(text);
  if (withCurrency) return withCurrency;
  // SBI-style, no currency token: "A/c X1234 debited by 250.0 on date 26Sep26"
  const bare = text.match(/\b(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d{1,2})?)\b/i);
  if (bare) {
    const minor = toMinorUnits(bare[1]);
    if (minor > 0) return { minor, index: bare.index ?? 0, currency: "INR" };
  }
  return null;
}

function findCurrencyAmount(text: string): { minor: number; index: number; currency: string } | null {
  const re = new RegExp(AMOUNT, "gi");
  let foreign: { minor: number; index: number; currency: string } | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 22), m.index);
    if (/(bal(ance)?|limit|lmt|avl|avbl|available|outstanding|due)[\s:.-]*(is|of)?[\s:.-]*$/i.test(before)) continue;
    const minor = toMinorUnits(m[2]);
    if (minor <= 0) continue;
    const currency = currencyOf(m[1]);
    // A spend abroad that also states what was billed in rupees ("$25.00 at STEAM (INR 2,150.00)"): the rupees win.
    if (currency === "INR") return { minor, index: m.index, currency };
    foreign ??= { minor, index: m.index, currency };
  }
  return foreign;
}

/** "Payment of Rs 25,000 received towards your ICICI Bank Credit Card", "Thank you for the payment ... on your
 * credit card": money into a card to settle its bill, which is neither spending nor income. A "." inside an amount
 * ("25,000.00") does not end the sentence. */
export function isCardPayment(text: string): boolean {
  // Money back on a card (a refund, cashback, a reversal) is a credit, not a bill payment.
  if (/\b(refund(?:ed)?|cashback|reversal|reversed)\b/i.test(text)) return false;
  // "Thank you for your payment of Rs 799 to Airtel using credit card": a spend with the card, not a payment to it.
  const spendWithCard = /\busing\s+(?:your\s+)?(?:\w+\s+)?(?:credit\s*)?card\b/i.test(text) || /\bpayment\s+of\s+[^.]{0,40}?\bto\s+(?!your\b)\w/i.test(text);
  const any = String.raw`(?:[^.]|\.(?=\d))`; // a "." inside an amount does not end the sentence
  const card = String.raw`(?:credit\s*card|\bcard\s+(?:ending|no\.?|xx|[x*]{2,}|\d{4}))`;
  return [
    String.raw`\bpayment\b${any}{0,100}?\b(?:received|credited)\b${any}{0,40}?\b(?:towards|to|on|in)\b${any}{0,30}?${card}`,
    String.raw`\breceived\s+(?:a\s+|your\s+|the\s+)?payment\b${any}{0,60}?\btowards\b${any}{0,30}?${card}`,
    String.raw`\bcredited\s+to\s+your\s+credit\s*card\b`,
    spendWithCard ? null : String.raw`\bthank\s*you\s+for\s+(?:the\s+|your\s+)?payment\b${any}{0,80}?${card}`,
  ].some((re) => re !== null && new RegExp(re, "i").test(text));
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

function findLast4(text: string, type?: "income" | "expense"): { last4: string; instrument: "card" | "account" } | null {
  // The account the money left (an expense) or reached (income), when the message says so: an EMI alert that also
  // names the loan a/c picks the person's own account, and "debited ... and credited to a/c XX5678" keeps the
  // payer's account for an expense.
  const verb = type === "income" ? String.raw`credited\s+to` : String.raw`(?:debited|deducted)\s+from`;
  const moved = type
    ? text.match(
        new RegExp(
          String.raw`\b${verb}\s+(?:your\s+)?(a\/c|acct|account|card)(?:\s*no\.?)?\s*(?:[x*]+|ending(?:\s+with)?\s*[x*]*)?\s*(\d{4})\b`,
          "i"
        )
      )
    : null;
  if (moved) return { last4: moved[2], instrument: /card/i.test(moved[1]) ? "card" : "account" };
  const match = text.match(
    /\b(a\/c|acct|account|card|a\/c no\.?|ac)\b[^\d]{0,24}?(?:[x*]+|ending(?:\s+with)?\s*[x*]*|no\.?\s*[x*]*)\s*(\d{4})\b/i
  );
  if (match && !/\bloan\s*$/i.test(text.slice(Math.max(0, (match.index ?? 0) - 6), match.index))) {
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

// A "." ends a merchant when a space, the end or a known tail word follows it ("AMAZON.Avl Lmt"), so a VPA like
// rahul.k@okaxis or a domain like NETFLIX.COM stays whole.
const MERCHANT_RE =
  /\b(at|to|from|towards|by|VPA|Info:?|trf to|paid to)\s+([A-Za-z0-9@._&*'/ -]{2,40}?)(?=\s+(?:on|ref|refno|ref\.?\s*no|via|at|from|to|by|a\/c|acct|avl|avbl|upi|dt|date|has|have|is|was|been|sms|\d{1,2}[-/])\b|\.(?=\s|$|(?:avl|avbl|bal|ref|info|not|txn|upi|call|sms|rs|inr|ur|your|thanks?|thank\s*you|dear|for)\b)|[,;(]|$)/gi;

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
    // A phone or account number is never the other party ("SMS BLOCK 7731 to 9215676766").
    if (/^\+?\d[\d\s-]{5,}/.test(value)) continue;
    if (/^(?:rs\.?|inr|₹)/i.test(value)) continue;
    value = value.replace(/\s+(bank)$/i, " $1");
    candidates.push({ value, preferred: preferred.test(m[1]) });
  }
  return (candidates.find((c) => c.preferred) ?? candidates[0])?.value;
}

/**
 * "Rs.5,000.00 withdrawn from A/c XX1234 at ATM ...", "Cash withdrawal of Rs 2000 ...",
 * "ATM WDL". Needs a cash-withdrawal word next to ATM, or an explicit "cash withdrawal",
 * so a card spend at a merchant called "ATM Foods" or a deposit at an ATM never matches.
 */
export function isAtmWithdrawal(text: string): boolean {
  return (
    /\bcash\s+(?:withdrawal|withdrawn|wdl)\b/i.test(text) ||
    /\b(?:withdrawn|withdrawal|wdl)\b[^.]{0,40}?\b(?:ATM|NFS)\b/i.test(text) ||
    /\b(?:ATM|NFS)[\s*/-]{0,3}(?:cash|wdl|withdrawal|withdrawn)\b/i.test(text)
  );
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
  const cardPayment = isCardPayment(text);
  const direction = cardPayment ? { type: "income" as const, ambiguous: false } : findDirection(text);
  if (!amount || !direction) return null;

  // A card bill payment names the card it paid; otherwise the account the money moved on.
  const cardDigits = cardPayment
    ? text.match(/\bcard\b[^\d]{0,24}?(?:[x*]+|ending(?:\s+with)?\s*[x*]*|no\.?\s*[x*]*)\s*(\d{4})\b/i)
    : null;
  const account = cardDigits ? { last4: cardDigits[1], instrument: "card" as const } : findLast4(text, direction.type);
  const parsedDate = parseMessageDate(text, receivedAt);
  const ref = findRef(text);
  const merchant = findMerchant(text, direction.type);

  let confidence = 0.35 + 0.25; // amount + direction
  if (account) confidence += 0.25;
  if (parsedDate) confidence += 0.1;
  if (ref || merchant) confidence += 0.05;
  if (direction.ambiguous) confidence -= 0.15;
  // Charged abroad: today's rate is not what the bank billed, so the person confirms the rupee amount.
  if (amount.currency !== "INR") confidence = Math.min(confidence, 0.6);
  // Paying a card bill is a move between the person's own accounts: always reviewed, never booked as income.
  if (cardPayment) confidence = Math.min(confidence, 0.5);

  return {
    kind: "money",
    parserId: "generic",
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    type: direction.type,
    amountMinor: amount.minor,
    currency: amount.currency,
    last4: account?.last4,
    instrument: cardPayment ? "card" : account?.instrument,
    merchant,
    ref,
    bankName: findBankName(text),
    date: parsedDate?.date,
    hasTime: parsedDate?.hasTime ?? false,
    ...(direction.type === "expense" && isAtmWithdrawal(text) ? { atm: true as const } : {}),
    ...(cardPayment ? { cardPayment: true as const } : {}),
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
