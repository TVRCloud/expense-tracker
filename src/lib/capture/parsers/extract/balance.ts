// The account's balance and a card's available limit, where a message prints them ("Avl Bal Rs.9,940.00",
// "New Bal :INR 880.40", "Avl Lmt INR 1,02,340.00"). Ticket 156. Kept on the parse only: never the amount of the
// transaction (findAmount skips these figures) and never a reason for more confidence.
//
// Only a figure in rupees that is clearly the account's own money is kept. Left out:
// - a masked figure ("INR xxxxxx") or one in another currency;
// - a negative or overdrawn one ("Rs.-1,200.00", "(-)", "1,200.00 Dr", "(Dr)", "210.00-"): what it means differs
//   between a bank account and a card, so it is not guessed;
// - a rule or warning ("Min Bal", "Min Avl Bal", "Insufficient balance", "Average Balance");
// - money that is not the account's own: an amount owed ("Outstanding", "Total", "Current" balance on a card), a loan
//   ("Loan Bal", "Principal Balance"), a wallet, cashback, FASTag, NCMC or reward balance;
// - money still to move ("Bal of Rs 1,000.00 will be debited", "to be paid", "due", "payable");
// - a limit that is not the card's credit limit ("Daily Avl Limit", cash, ATM, UPI or per-transaction limits);
// - a bare "Bal" with no currency ("GLOBAL BAL 12.50" in a shop name).
// The caller (base.ts) also drops a figure printed next to another account's digits ("A/c XX9999 Avl Bal ...").
//
// Every part of each pattern is bounded, so a long or padded message cannot make it backtrack badly.

import { toMinorUnits } from "./amount";

export interface FoundFigure {
  /** Paise. */
  minor: number;
  /** Masked digits printed right before the label ("A/c XX9999 Avl Bal"): whose figure it is, when the message says. */
  owner?: string;
}

const AVAILABLE = String.raw`(?:avl|avbl|avlbl|avb|avail|available)\.?\s{0,2}`;
// Words that make the next "balance" something else than the account's money after this transaction.
const NOT_THIS_BALANCE = String.raw`(?<!\b(?:min(?:imum)?|avg|average|monthly|mab|maintain(?:ed)?|low|insufficient|required|outstanding|total|current|loan|principal|emi|cashback|wallet|fastag|ncmc|card|points?|rewards?|loyalty|gift|prepaid)\.?\s{0,2}(?:${AVAILABLE})?)`;
const BALANCE_LABEL = String.raw`${NOT_THIS_BALANCE}\b((?:${AVAILABLE}|(?:clr|clear|closing|new|ledger|a\/c|acct)\.?\s{0,2}))?bal(?:ance)?\b`;
// Only the card's credit limit: never a daily, cash, ATM, UPI or per-transaction limit.
const NOT_CREDIT_LIMIT = String.raw`(?<!\b(?:daily|day|cash|withdrawal|atm|upi|txn|transaction|pos|online|contactless|ecom|international)\.?\s{0,2})`;
const LIMIT_LABEL = String.raw`${NOT_CREDIT_LIMIT}\b(${AVAILABLE})(?:(?:credit|cr)\.?\s{0,2})?(?:limit|lmt)\b`;
// Between the label and the figure: spaces, a colon or dot, "is", "is now", "now", "of". A "-" counts as a separator
// only when no digit follows it, so "Bal: -500" is read as negative, never as 500.
const SEP = String.raw`(?:[\s:.]|-(?!\s?\d)){0,4}`;
const BETWEEN = String.raw`${SEP}(?:(?:is\s{1,2})?(?:now\s{1,2})?|of\s{1,2})${SEP}`;
const CURRENCY = String.raw`(Rs\.?|INR|₹|USD|EUR|GBP|AED|SGD|AUD|CAD|CHF|HKD|NZD|SAR|QAR|THB|MYR|US\$|\$|€|£)?\s{0,2}`;
const SIGN = String.raw`(\(-\)|-)?\s{0,2}`;
// The figure, never part of a date or a longer number ("12.11.26", "12/11").
const FIGURE = String.raw`([\d,]{1,15}(?:\.\d{1,2})?)(?![\d,]|\.\d|[/-]\d)`;
// Overdrawn after the figure: "Dr", "(Dr)", "(-)", or a "-" glued to it ("210.00-"; "210.00-SBI" is a signature).
const OVERDRAWN = String.raw`(\s{0,2}(?:\(\s?(?:dr|-)\s?\)|dr\b)|-(?![A-Za-z]))?`;

const BALANCE_RE = new RegExp(BALANCE_LABEL + BETWEEN + CURRENCY + SIGN + FIGURE + OVERDRAWN, "i");
const LIMIT_RE = new RegExp(LIMIT_LABEL + BETWEEN + CURRENCY + SIGN + FIGURE + OVERDRAWN, "i");
// Money still to move after the figure.
const STILL_TO_MOVE = /^\s{0,3}(?:will\s{1,2}be|to\s{1,2}be|is\s{1,2}due|due|payable)\b/i;
// Masked digits right before the label: "A/c XX9999 Avl Bal", "card ending 9999 Avl Lmt".
const OWNER = /(?:[x*]{2,}\s?|ending\s{1,2}(?:with\s{1,2})?[x*]{0,8})(\d{3,4})[\s.,:;-]{0,3}$/i;
/** Highest figure kept: one lakh crore rupees. */
const MAX_MINOR = 1e13;

function figureAfterLabel(re: RegExp, text: string): FoundFigure | undefined {
  // Only the first labelled figure: a message names its balance once, and a later one could be another account's.
  const m = re.exec(text);
  if (!m) return undefined;
  const [whole, prefix, currency, sign, figure, overdrawn] = m;
  if (sign || overdrawn) return undefined;
  if (STILL_TO_MOVE.test(text.slice(m.index + whole.length, m.index + whole.length + 20))) return undefined;
  const code = currency?.toUpperCase().replace(/\.$/, "");
  if (code && code !== "RS" && code !== "INR" && code !== "₹") return undefined;
  // A bare "Bal" needs a currency ("GLOBAL BAL 12.50" is a shop); with a word like "Avl" a figure with paise will do,
  // so a count or a reference is never read as money.
  if (!code && (!prefix || !/\.\d{2}$/.test(figure))) return undefined;
  // A comma right after the figure ends the sentence ("Bal Rs 210, thanks"); inside, the digits must be grouped the
  // Indian way ("1,23,456.00") or in thousands ("123,456.00"), so a garbled figure ("2,10.00") is left out.
  const plain = figure.replace(/,$/, "");
  const integer = plain.split(".")[0];
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$/.test(integer)) return undefined;
  const minor = toMinorUnits(plain);
  if (!Number.isSafeInteger(minor) || minor < 0 || minor >= MAX_MINOR) return undefined;
  const owner = text.slice(Math.max(0, m.index - 24), m.index).match(OWNER)?.[1];
  return owner ? { minor, owner } : { minor };
}

/** The balance a message prints, with whose digits it is printed next to, or undefined. */
export function readBalance(text: string): FoundFigure | undefined {
  return figureAfterLabel(BALANCE_RE, text);
}

/** A card's available credit limit, with whose digits it is printed next to, or undefined. */
export function readAvailableLimit(text: string): FoundFigure | undefined {
  return figureAfterLabel(LIMIT_RE, text);
}

/** The balance a message prints, in paise, or undefined when it prints none in rupees. */
export function findBalance(text: string): number | undefined {
  return readBalance(text)?.minor;
}

/** A card's available limit, in paise, or undefined when the message prints none in rupees. */
export function findAvailableLimit(text: string): number | undefined {
  return readAvailableLimit(text)?.minor;
}
