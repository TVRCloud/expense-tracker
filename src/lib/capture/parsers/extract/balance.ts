// The account's balance and a card's available limit, where a message prints them ("Avl Bal Rs.9,940.00",
// "New Bal :INR 880.40", "Avl Lmt INR 1,02,340.00"). Ticket 156. Kept on the parse only: never the amount of the
// transaction (findAmount skips these figures) and never a reason for more confidence.
//
// Only a figure in rupees is kept: the account is counted in rupees, so a balance written in another currency, or one
// that is masked ("INR xxxxxx"), is left out. A negative or overdrawn balance ("Rs.-1,200.00", "(-)", "1,200.00 Dr")
// is left out too: what it means differs between a bank account and a card, so it is not guessed.
//
// Every part of each pattern is bounded, so a long or padded message cannot make it backtrack badly.

import { toMinorUnits } from "./amount";

// "Min Bal", "Average Balance", "Low balance": a rule or a warning, not the balance after this transaction.
const NOT_THIS_BALANCE = String.raw`(?<!\b(?:min(?:imum)?|avg|average|monthly|mab|maintain(?:ed)?|low|insufficient|required)\.?\s{0,2})`;
const BALANCE_LABEL = String.raw`${NOT_THIS_BALANCE}\b(?:(?:avl|avbl|avlbl|avail|available|clr|clear|closing|new|current|ledger|total|a\/c|acct)\.?\s{0,2})?bal(?:ance)?\b`;
const LIMIT_LABEL = String.raw`\b(?:avl|avbl|avlbl|avail|available)\.?\s{0,2}(?:(?:credit|cr)\.?\s{0,2})?(?:limit|lmt)\b`;
// Between the label and the figure: spaces, a colon or dot, "is", "of", "now", "Rs"/"INR". A "-" counts as a separator
// only when no digit follows it, so "Bal: -500" is read as negative, never as 500.
const BETWEEN = String.raw`(?:[\s:.]|-(?!\s?\d)){0,4}(?:(?:is|of|now)\s{1,2})?(?:[\s:.]|-(?!\s?\d)){0,3}`;
const CURRENCY = String.raw`(Rs\.?|INR|₹|USD|EUR|GBP|AED|SGD|AUD|CAD|CHF|HKD|NZD|SAR|QAR|THB|MYR|US\$|\$|€|£)?\s{0,2}`;
const SIGN = String.raw`(\(-\)|-)?\s{0,2}`;
// The figure, never part of a date or a longer number ("12.11.26", "12/11").
const FIGURE = String.raw`([\d,]{1,15}(?:\.\d{1,2})?)(?![\d,]|\.\d|[/-]\d)`;
const OVERDRAWN = String.raw`(\s{0,2}Dr\b)?`;

const BALANCE_RE = new RegExp(BALANCE_LABEL + BETWEEN + CURRENCY + SIGN + FIGURE + OVERDRAWN, "i");
const LIMIT_RE = new RegExp(LIMIT_LABEL + BETWEEN + CURRENCY + SIGN + FIGURE + OVERDRAWN, "i");

function rupeesAfterLabel(re: RegExp, text: string): number | undefined {
  // Only the first labelled figure: a message names its balance once, and a later one could be another account's.
  const m = text.match(re);
  if (!m) return undefined;
  const [, currency, sign, figure, overdrawn] = m;
  if (sign || overdrawn) return undefined;
  const code = currency?.toUpperCase().replace(/\.$/, "");
  if (code && code !== "RS" && code !== "INR" && code !== "₹") return undefined;
  // With no currency the figure must have paise ("Bal: 1,234.56"), so a count or a reference is never read as money.
  if (!code && !/\.\d{2}$/.test(figure)) return undefined;
  if (!/\d/.test(figure) || /^,|,,/.test(figure)) return undefined;
  const minor = toMinorUnits(figure);
  return Number.isFinite(minor) && minor >= 0 ? minor : undefined;
}

/** The balance a message prints, in paise, or undefined when it prints none in rupees. */
export function findBalance(text: string): number | undefined {
  return rupeesAfterLabel(BALANCE_RE, text);
}

/** A card's available limit, in paise, or undefined when the message prints none in rupees. */
export function findAvailableLimit(text: string): number | undefined {
  return rupeesAfterLabel(LIMIT_RE, text);
}
