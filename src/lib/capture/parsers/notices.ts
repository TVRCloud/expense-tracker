// Messages about money that did not move in this message: a mandate set up, changed, paused, resumed or revoked,
// and a fund house's note about a mutual fund SIP, purchase, allotment, redemption or switch (ticket 157). They run
// for every sender, right after the OTP check and before the other ignore checks, so a mandate notice is never read
// as a payment request and a fund house's "SIP purchase of Rs 5,000" is never booked as spending (the bank sends its
// own debit for that money). Written for this codebase from invented examples.
//
// Every pattern is bounded and runs on whitespace-collapsed text, so a long or padded message cannot backtrack badly.

import { parseMessageDate } from "./dates";
import { findAmount, toMinorUnits } from "./extract/amount";
import { findBankName, findLast4 } from "./extract/account";
import { CREDIT_WORDS, DEBIT_WORDS } from "./extract/direction";
import type { InvestmentParse, MandateParse } from "./types";

/** A mandate word: UPI AutoPay, e-mandate, NACH, a card's standing instruction, a mandate reference. */
export const MANDATE_WORD = /\b(?:e-?mandate|mandates?|auto\s?-?pay|NACH|standing\s+instructions?|UMRN|UMN)\b/i;
const MANDATE_SRC = String.raw`(?:e-?mandate|mandates?|auto\s?-?pay|NACH|standing\s+instructions?|SI)`;

// What happened to the mandate. A word that only says it was used ("processed", "executed") is a payment, not this.
const EVENT_WORDS: [MandateParse["event"], string][] = [
  ["revoked", String.raw`revoked|cancell?ed|deactivated|discontinued|deleted|terminated|stopped`],
  ["paused", String.raw`paused|suspended|put\s+on\s+hold`],
  ["resumed", String.raw`resumed|reactivated|unpaused`],
  ["modified", String.raw`modified|updated|changed|amended|revised`],
  ["created", String.raw`created|registered|set\s?-?up|activated|accepted|approved|successfully\s+(?:added|linked)`],
];
// The event must belong to the mandate itself: the mandate word and the event in one clause, at most
// 100 characters apart ("UPI-Mandate for Rs.637.00 is successfully created", "created a mandate on"), never across a
// sentence end. "Balance updated." after a NACH credit is not a mandate being updated.
const CLAUSE = String.raw`(?:[^.;!?\n]|\.(?=\d))`;
const EVENTS: [MandateParse["event"], RegExp, RegExp][] = EVENT_WORDS.map(([event, words]) => [
  event,
  new RegExp(String.raw`\b${MANDATE_SRC}\b${CLAUSE}{0,100}?\b(?:${words})\b`, "i"),
  new RegExp(String.raw`\b(?:${words})\s(?:a\s|an\s|the\s|your\s)?(?:new\s)?(?:UPI\s)?${MANDATE_SRC}\b`, "i"),
]);

// Money moved in this message, so it is a payment or a credit, never a notice. When in doubt it is money: a missed
// notice only costs a Review item, a wrongly kept notice loses a payment without a trace.
const MOVED_MORE =
  /\b(?:debit|dr|cr|executed|processed|done|paid|used|wdl|txn|deposited|withdrawn|charged|received|sent|transferred|payment\s+successful)\b|(?<!\b(?:created|registered|set\s?-?up|setup|activated|added|linked|modified|updated|revoked|cancell?ed|paused|resumed)\s)\bsuccessful(?:ly)?\b(?!\s+(?:created|registered|set\s?-?up|setup|activated|added|linked|modified|updated|revoked|cancell?ed|paused|resumed)\b)/i;

// A mandate notice may print an amount only as the mandate's limit: right after a limit word ("max", "up to",
// "limit"), after "mandate/AutoPay/NACH/SI ... for|of" in the same clause, or after "modified/changed/revised to".
// Any other amount, an amount printed next to an account or card mask, or a "transaction of" an amount means money
// moved, so the message is money or Review, never a notice. This is structural on purpose: a list of money verbs
// can never be complete ("recovered", "pulled", "realised", "billed", "ka bhugtan").
const AMOUNT_ANY = /(?:Rs\.?|INR|₹|US\$|\$)\s?[\d,]{1,15}(?:\.\d{1,2})?/gi;
const LIMIT_BEFORE = new RegExp(
  String.raw`(?:\b(?:max(?:imum)?\.?(?:\s(?:amount|amt|limit|debit))?(?:\sof)?|up\s?to|upto|limit(?:\sof)?|not\sexceeding|(?:modified|changed|revised|amended|increased|reduced|updated)\sto)|\b${MANDATE_SRC}\b${CLAUSE}{0,60}?\b(?:for|of))\s{0,2}:?\s{0,2}$`,
  "i"
);
const MASK_NEAR = /(?:\b(?:a\/c|acct|account|card)\b[^.;\d]{0,12}?[x*]{1,12}\s?\d{3,4}|\b[x*]{2,}\d{3,4}\b)/i;
const TRANSACTION_OF = /\b(?:transaction|txn|trxn)s?\s+(?:of|for|worth|amount)\b/i;

/** Every amount the message prints is the mandate's limit, and none sits next to an account or card. */
function onlyLimitAmounts(text: string): boolean {
  if (TRANSACTION_OF.test(text)) return false;
  for (const m of text.matchAll(AMOUNT_ANY)) {
    const index = m.index ?? 0;
    const before = text.slice(Math.max(0, index - 90), index);
    // The clause before the amount: back to the last sentence end.
    const clause = before.slice(Math.max(before.lastIndexOf(". "), before.lastIndexOf(";"), before.lastIndexOf("!")) + 1);
    if (!LIMIT_BEFORE.test(clause)) return false;
    const around = text.slice(Math.max(0, index - 30), index + m[0].length + 30);
    if (MASK_NEAR.test(around)) return false;
  }
  return true;
}

export function moneyMoved(text: string): boolean {
  return DEBIT_WORDS.test(text) || CREDIT_WORDS.test(text) || MOVED_MORE.test(text);
}
// Not a settled mandate: a request waiting for approval, a failure, or a pre-debit notice (those stay with ignore.ts).
const NOT_A_NOTICE =
  /\b(?:has|have)\s+requested\b|\bcollect\s+request\b|\b(?:approve|authori[sz]e)\s+(?:the|this|your)\b|\bpending\s+(?:for\s+)?(?:approval|authori[sz]ation)\b|\b(?:failed|declined|unsuccessful|rejected|could\s+not\s+be)\b|\bpre-?debit\b/i;

const STOP = String.raw`(?=\s(?:has|have|is|was|for|on|with|from|of|via|by|till|until|starting|from|UMN|UMRN|ID|mandate|e-mandate|AutoPay|created|registered|modified|updated|revoked|cancell?ed|paused|resumed|suspended|stopped|deactivated|successfully|setup|set|through|as\s+per)\b|[.,;:(]|$)`;
const PARTY = String.raw`(\S[^.;:,()]{0,58}?)`;
// Tried in order; within one pattern every match is tried, so "for Rs.649 ... towards STREAMLY" still finds STREAMLY.
const MERCHANT_PATTERNS = [
  new RegExp(String.raw`\bin\s+favou?r\s+of\s+${PARTY}${STOP}`, "gi"),
  new RegExp(String.raw`\b(?:e-?mandate|mandate|auto\s?-?pay|standing\s+instruction|SI)\s+(?:on|for|to|towards|with)\s+${PARTY}${STOP}`, "gi"),
  new RegExp(String.raw`\b(?:towards|for)\s+${PARTY}\s+(?:e-?mandate|mandate|auto\s?-?pay|subscription)\b`, "gi"),
  new RegExp(String.raw`\b(?:towards|for|to)\s+${PARTY}${STOP}`, "gi"),
];
// Words that follow "for" or "towards" but are never the merchant.
const NOT_A_MERCHANT =
  /^(?:rs\.?|inr|₹|\d|a|an|the|your|you|my|this|max(?:imum)?|amount|amt|up\s?to|daily|weekly|fortnightly|monthly|quarterly|half[\s-]?yearly|yearly|annual(?:ly)?|every|as\s+and\s+when|as\s+presented|one[\s-]?time|a\/c|acct|account|card|upi|nach|e-?mandate|mandate|auto\s?-?pay|details|more|any|queries|help|support|cancellation|modification|registration)\b/i;

const MAX_AMOUNT =
  /\b(?:max(?:imum)?\.?(?:\s+(?:amount|amt|limit|debit))?(?:\s+of)?|up\s?to|upto|limit\s+of|not\s+exceeding)\s*:?\s*(?:Rs\.?|INR|₹)\s?([\d,]{1,15}(?:\.\d{1,2})?)/i;
const FREQUENCY =
  /\b(daily|weekly|fortnightly|monthly|quarterly|half[\s-]?yearly|yearly|annually|as\s+and\s+when\s+presented|as\s+presented|one[\s-]?time)\b/i;
const START = /\b(?:starting|start\s+date|commencing|effective|first\s+debit)\s*(?:from|on|date)?\s*:?\s*/i;
const UNTIL = /\b(?:valid\s+(?:till|until|upto|up\s+to)|end\s+date|ending\s+on|expir(?:es|y)\s+(?:on|date)?|till|until)\s*:?\s*/i;

function minorOf(text: string): number | undefined {
  const minor = toMinorUnits(text);
  return Number.isSafeInteger(minor) && minor > 0 && minor < 1e13 ? minor : undefined;
}

/** A date printed right after a keyword ("starting from 05-12-2026"), at noon IST. */
function dateAfter(text: string, keyword: RegExp): Date | undefined {
  const m = keyword.exec(text);
  if (!m) return undefined;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
  // Only a date that starts right there, not one further along the message.
  if (!/^\d{1,2}[\s/.-]|^\d{4}-/.test(after)) return undefined;
  return parseMessageDate(after, new Date(0))?.date;
}

function cleanMerchant(raw: string | undefined): string | undefined {
  const v = raw
    ?.replace(/\s+/g, " ")
    .trim()
    .replace(/[ .*\-]{1,5}$/, "")
    // A verb the bank wrote after the name ("STREAMLY processed").
    .replace(/\s(?:processed|done|executed|successful(?:ly)?|completed|suspended|stopped|revoked|cancell?ed|paused|resumed|modified|updated|created|registered)$/i, "")
    .replace(/\s(?:through|via|using)\s(?:UPI|NACH|AutoPay|e-?mandate)$/i, "");
  if (!v || v.length < 2 || !/[A-Za-z]{2}/.test(v) || NOT_A_MERCHANT.test(v)) return undefined;
  // A masked number or an amount is never the merchant.
  if (/[x*]{2,}\d|\b(?:rs|inr)\.?\s?\d|\d{6,}/i.test(v) || /[A-Z]{5}\d{4}[A-Z]/i.test(v)) return undefined;
  // A mandate reference written like a UPI id ("4f2a91c0d2@okaxis") is never the merchant.
  if (/(?:^|\s)[a-z0-9]{8,}@/i.test(v) && /\d/.test(v.split("@")[0])) return undefined;
  return v.slice(0, 60);
}

/** A mandate set up, changed, paused, resumed or revoked, when no money moved in the message. */
export function parseMandateNotice(raw: string): MandateParse | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!MANDATE_WORD.test(text) || moneyMoved(text) || NOT_A_NOTICE.test(text) || !onlyLimitAmounts(text)) return null;
  const event = EVENTS.find(([, after, before]) => after.test(text) || before.test(text))?.[0];
  if (!event) return null;

  let merchant: string | undefined;
  find: for (const re of MERCHANT_PATTERNS) {
    // matchAll copies the regex, so the shared pattern keeps no lastIndex between calls.
    for (const m of text.matchAll(re)) {
      // A UPI id runs on past its dots ("john.doe.98@okicici"): take it whole, then judge it.
      const after = text.slice((m.index ?? 0) + m[0].length);
      const vpaTail = /^\.[\w.-]{0,40}@[a-z][\w-]{1,20}/i.exec(after)?.[0] ?? "";
      merchant = cleanMerchant(m[1] + vpaTail);
      if (merchant) break find;
    }
  }
  const max = MAX_AMOUNT.exec(text);
  const anyAmount = max ? null : findAmount(text);
  const maxAmountMinor = max ? minorOf(max[1]) : anyAmount?.currency === "INR" ? anyAmount.minor : undefined;
  const account = findLast4(text);

  return {
    kind: "mandate",
    parserId: "mandate",
    confidence: 0.9,
    event,
    merchant,
    maxAmountMinor,
    frequency: FREQUENCY.exec(text)?.[1].toLowerCase().replace(/\s+/g, " "),
    bankName: findBankName(text),
    last4: account?.last4,
    startDate: dateAfter(text, START),
    validUntil: dateAfter(text, UNTIL),
  };
}

// A fund house's own words: a folio, a NAV, units allotted or redeemed, a mutual fund or an AMC. A bare "fund"
// ("Relief Fund", "fund transfer") is never enough.
const FUND_SIGNAL = /\b(?:folio|NAV|mutual\s+funds?|AMC|units?\s+(?:allott?ed|redeemed|switched|purchased)|(?:allott?ed|redeemed)\s+[\d,.]{1,14}\s*units)\b/i;
// The figures only a fund house prints: with them, "purchase" names the fund event, not a spend.
const FUND_FIGURES = /\b(?:folio|NAV)\b|\bunits?\s+(?:allott?ed|redeemed|switched|purchased)\b|\b[\d,]{1,12}\.\d{1,4}\s*units\b/i;
const FUND_EVENT =
  /\b(?:SIP|purchases?|purchased|allot(?:ted|ment)?|alloted|redeem(?:ed)?|redemption|switch(?:ed)?|lump\s?sum)\b/i;
const FUND_DONE =
  /\b(?:processed|allott?ed|confirmed|registered|redeemed|switched|executed|accepted|completed|(?:has|have)\s+been)\b/i;
// Not a settled fund event: a failure, a due or upcoming instalment, an advert.
const NOT_FUND_EVENT =
  /\b(?:failed|declined|unsuccessful|rejected|could\s+not\s+be|insufficient|bounced|due\s+(?:on|date|by)|upcoming|scheduled|reminder|will\s+be\s+(?:debited|deducted|presented|auto-?debited)|start\s+(?:a|your)\s+SIP|invest\s+now|click|apply|download|offer|why\s+wait|IPO|refund(?:ed)?)\b/i;
// Money that moved on the person's own account or card in this message: that one is the money, so the message stays a
// money parse (booked or in Review). "purchase" alone is a fund word when the fund's own figures are printed.
const MONEY_HERE =
  /(?<!\b(?:will|to|shall|would)\s+be\s+)\b(?:debited|credited|debit|dr|cr|spent|paid|sent|received|deposited|withdrawn|transferred|deducted|charged|used|wdl|txn|refund(?:ed)?|reversed|collected|remitted|paid\s+out|jama|credited\s+back|payment\s+(?:of|successful))\b/i;
const FOLIO_FIGURE = /\bfolio\s*(?:no\.?|number|#)?\s*[:\-]?\s*[x*]{0,12}\d{4,20}(?:\/\d{1,4})?/gi;

// A fund's name: up to eight words ending in Fund, FoF or ETF, never a folio, a PAN, an amount or an account.
const NAME_WORD = String.raw`(?!(?:folio|pan|rs|inr|a\/c|acct|account|units?|sip|nav)\b)(?:[A-Za-z][\w&'-]{0,30}|\d{1,3})`;
const FUND_NAME = new RegExp(
  String.raw`\b(?:in|of|for|from|into|to|under)\s+((?:${NAME_WORD}\s){0,8}?(?:Fund|FoF|ETF)\b(?:\s(?:-\s)?(?:Direct|Regular|Growth|IDCW|DG|RG|Dir|Gr|Plan|Option)\b){0,4})`,
  "gi"
);
const UNSAFE_NAME = /\d{5,}|[A-Z]{5}\d{4}[A-Z]|\b(?:folio|pan|rs|inr|a\/c)\b|[x*]{2,}\d/i;
const UNITS =
  /\b(?:units?\s*(?:allott?ed|redeemed|purchased|switched)?\s*(?:is|are|:|-|of)?\s*([\d,]{1,12}\.\d{1,4})\b|([\d,]{1,12}\.\d{1,4})\s*units\b)/i;
const NAV = /\bNAV\s*(?:of|:|is|@|at)?\s*(?:Rs\.?|INR|₹)?\s*([\d,]{1,8}\.\d{1,4})\b/i;
const FOLIO = /\bfolio\s*(?:no\.?|number|#)?\s*[:\-]?\s*[x*]{0,12}(\d{4,20})/i;

function fundEvent(text: string): InvestmentParse["event"] {
  if (/\bredeem(?:ed)?\b|\bredemption\b/i.test(text)) return "redemption";
  if (/\bswitch(?:ed)?\b/i.test(text)) return "switch";
  if (/\bSIP\b/i.test(text)) return "sip";
  if (/\bpurchases?\b|\bpurchased\b|\blump\s?sum\b/i.test(text)) return "purchase";
  return "allotment";
}

function fundName(text: string): string | undefined {
  for (const m of text.matchAll(FUND_NAME)) {
    const name = m[1].trim();
    if (!UNSAFE_NAME.test(name)) return name.slice(0, 80);
  }
  return undefined;
}

/** A fund house's or registrar's note about a SIP, purchase, allotment, redemption or switch. Only when it has the
 * fund's own shape and nothing says money moved on the person's account or card; otherwise it stays money. */
export function parseInvestment(raw: string, receivedAt: Date): InvestmentParse | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!FUND_SIGNAL.test(text) || !FUND_EVENT.test(text) || !FUND_DONE.test(text) || NOT_FUND_EVENT.test(text)) return null;
  // Money moved: any money word, a "purchase" without the fund's own figures, or the person's account or card named.
  if (MONEY_HERE.test(text) || CREDIT_WORDS.test(text)) return null;
  if (DEBIT_WORDS.test(text.replace(/\bpurchases?\b/gi, " ")) || (/\bpurchases?\b/i.test(text) && !FUND_FIGURES.test(text))) return null;
  if (findLast4(text.replace(FOLIO_FIGURE, " "))) return null;

  const amount = findAmount(text);
  const units = UNITS.exec(text);
  const folio = FOLIO.exec(text)?.[1];
  return {
    kind: "investment",
    parserId: "investment",
    confidence: 0.9,
    event: fundEvent(text),
    fundName: fundName(text),
    amountMinor: amount?.currency === "INR" ? amount.minor : undefined,
    units: (units?.[1] ?? units?.[2])?.replace(/,/g, ""),
    nav: NAV.exec(text)?.[1].replace(/,/g, ""),
    folioLast4: folio?.slice(-4),
    date: parseMessageDate(text, receivedAt)?.date,
  };
}
