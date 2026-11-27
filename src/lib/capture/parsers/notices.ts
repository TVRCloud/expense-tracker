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
import type { InvestmentParse, MandateParse } from "./types";

/** A mandate word: UPI AutoPay, e-mandate, NACH, a card's standing instruction, a mandate reference. */
export const MANDATE_WORD = /\b(?:e-?mandate|mandates?|auto\s?-?pay|NACH|standing\s+instructions?|UMRN|UMN)\b/i;

// What happened to the mandate. A word that only says it was used ("processed", "executed") is a payment, not this.
const EVENTS: [MandateParse["event"], RegExp][] = [
  ["revoked", /\b(?:revoked|cancell?ed|deactivated|discontinued|deleted|terminated|stopped)\b/i],
  ["paused", /\b(?:paused|suspended|put\s+on\s+hold)\b/i],
  ["resumed", /\b(?:resumed|reactivated|unpaused)\b/i],
  ["modified", /\b(?:modified|updated|changed|amended|revised)\b/i],
  ["created", /\b(?:created|registered|set\s?-?up|activated|accepted|approved|successfully\s+(?:added|linked))\b/i],
];

// Money that already moved in this message. "will be debited" is a promise, not this.
const MOVED =
  /(?<!\b(?:will|to|shall|would)\s+be\s+)\b(?:debited|deducted|credited|paid|spent|withdrawn|sent|transferred|charged|refunded|reversed)\b/i;
// Not a settled mandate: a request waiting for approval, a failure, or a pre-debit notice (those stay with ignore.ts).
const NOT_A_NOTICE =
  /\b(?:has|have)\s+requested\b|\bcollect\s+request\b|\b(?:approve|authori[sz]e)\s+(?:the|this|your)\b|\bpending\s+(?:for\s+)?(?:approval|authori[sz]ation)\b|\b(?:failed|declined|unsuccessful|rejected|could\s+not\s+be)\b|\bpre-?debit\b/i;

const STOP = String.raw`(?=\s(?:has|have|is|was|for|on|with|from|of|via|by|till|until|starting|from|UMN|UMRN|ID|mandate|e-mandate|AutoPay|created|registered|modified|updated|revoked|cancell?ed|paused|resumed|successfully|setup|set)\b|[.,;:(]|$)`;
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
    .replace(/[ .*\-]{1,5}$/, "");
  if (!v || v.length < 2 || !/[A-Za-z]{2}/.test(v) || NOT_A_MERCHANT.test(v)) return undefined;
  // A masked number or an amount is never the merchant.
  if (/[x*]{2,}\d|\b(?:rs|inr)\.?\s?\d|\d{6,}/i.test(v)) return undefined;
  return v.slice(0, 60);
}

/** A mandate set up, changed, paused, resumed or revoked, when no money moved in the message. */
export function parseMandateNotice(raw: string): MandateParse | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!MANDATE_WORD.test(text) || MOVED.test(text) || NOT_A_NOTICE.test(text)) return null;
  const event = EVENTS.find(([, re]) => re.test(text))?.[0];
  if (!event) return null;

  let merchant: string | undefined;
  find: for (const re of MERCHANT_PATTERNS) {
    // matchAll copies the regex, so the shared pattern keeps no lastIndex between calls.
    for (const m of text.matchAll(re)) {
      merchant = cleanMerchant(m[1]);
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

// A fund house's words: the fund, a folio, a NAV, an AMC.
const FUND_SIGNAL = /\b(?:mutual\s+funds?|folio|NAV|fund|AMC|units?\s+allott?ed)\b/i;
const FUND_EVENT =
  /\b(?:SIP|purchases?|purchased|allot(?:ted|ment)?|alloted|redeem(?:ed)?|redemption|switch(?:ed)?|lump\s?sum|subscription)\b/i;
const FUND_DONE =
  /\b(?:processed|allott?ed|confirmed|received|successful(?:ly)?|registered|redeemed|switched|executed|purchased|accepted|completed|(?:has|have)\s+been)\b/i;
// Not a settled fund event: a failure, a due or upcoming instalment, an advert, a NAV update.
const NOT_FUND_EVENT =
  /\b(?:failed|declined|unsuccessful|rejected|could\s+not\s+be|insufficient|bounced|due\s+(?:on|date|by)|upcoming|scheduled|reminder|will\s+be\s+(?:debited|deducted|presented|auto-?debited)|start\s+(?:a|your)\s+SIP|invest\s+now|click|apply|download|offer|why\s+wait)\b/i;
// The bank's own message about the person's account: that one is the money, and stays a normal parse.
const BANK_MOVE = [
  /(?<!\b(?:will|to|shall)\s+be\s+)\b(?:debited|credited|charged)\s+(?:from|to|in|into|on)\s+(?:your\s+)?(?:bank\s+|savings\s+|credit\s+|debit\s+)?(?:a\/c|acct|account|card)\b/i,
  // Spent or charged on the person's card or account: that is the money too.
  /(?<!\b(?:will|to|shall)\s+be\s+)\b(?:spent|withdrawn)\b/i,
  /\b(?:a\/c|acct|account|card)\s?(?:no\.?)?\s?[x*]{1,12}\d{3,4}\s(?:is\s|has\sbeen\s|was\s)?(?:debited|credited|charged)\b/i,
  /\b(?:debited|credited)\s+(?:from|to)\s+(?:a\/c|acct|account)\s?(?:no\.?)?\s?[x*]{1,12}\d{3,4}\b/i,
];

const FUND_NAME =
  /\b(?:in|of|for|from|into|to|under)\s+((?:[A-Za-z0-9][\w&'-]{0,30}\s){0,8}?(?:Fund|FoF|ETF)\b(?:\s(?:-\s)?(?:Direct|Regular|Growth|IDCW|DG|RG|Dir|Gr|Plan|Option)\b){0,4})/i;
const UNITS =
  /\b(?:units?\s*(?:allott?ed|redeemed|purchased|switched)?\s*(?:is|are|:|-|of)?\s*([\d,]{1,12}\.\d{1,4})\b|([\d,]{1,12}\.\d{1,4})\s*units\b)/i;
const NAV = /\bNAV\s*(?:of|:|is|@|at)?\s*(?:Rs\.?|INR|₹)?\s*([\d,]{1,8}\.\d{1,4})\b/i;
const FOLIO = /\bfolio\s*(?:no\.?|number|#)?\s*[:\-]?\s*[x*]{0,12}(\d{4,20})/i;

function fundEvent(text: string): InvestmentParse["event"] {
  if (/\bredeem(?:ed)?\b|\bredemption\b/i.test(text)) return "redemption";
  if (/\bswitch(?:ed)?\b/i.test(text)) return "switch";
  if (/\bSIP\b/i.test(text)) return "sip";
  if (/\bpurchases?\b|\bpurchased\b|\blump\s?sum\b|\bsubscription\b/i.test(text)) return "purchase";
  return "allotment";
}

/** A fund house's or registrar's note about a SIP, purchase, allotment, redemption or switch. */
export function parseInvestment(raw: string, receivedAt: Date): InvestmentParse | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!FUND_SIGNAL.test(text) || !FUND_EVENT.test(text) || !FUND_DONE.test(text)) return null;
  if (NOT_FUND_EVENT.test(text) || BANK_MOVE.some((re) => re.test(text))) return null;

  const amount = findAmount(text);
  const units = UNITS.exec(text);
  const folio = FOLIO.exec(text)?.[1];
  return {
    kind: "investment",
    parserId: "investment",
    confidence: 0.9,
    event: fundEvent(text),
    fundName: FUND_NAME.exec(text)?.[1].trim().slice(0, 80),
    amountMinor: amount?.currency === "INR" ? amount.minor : undefined,
    units: (units?.[1] ?? units?.[2])?.replace(/,/g, ""),
    nav: NAV.exec(text)?.[1].replace(/,/g, ""),
    folioLast4: folio?.slice(-4),
    date: parseMessageDate(text, receivedAt)?.date,
  };
}
