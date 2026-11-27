// What every bank parser shares: the bonus it earns only for its own message shapes, the guards that keep an unsure
// read in Review, and small readers for the parties banks write in their own way. Written for this codebase from
// invented examples (ticket 155).
//
// Every capture group here is bounded (at most about 60 characters) and the text has its whitespace collapsed
// first, so no pattern can backtrack badly on a long or padded message.

import { BankParser } from "../base";
import { CREDIT_WORDS, DEBIT_WORDS, isCardPayment } from "../extract/direction";
import type { FoundAccount } from "../extract/account";
import type { MoneyParse } from "../types";

/** Added when a message has one of the bank's known shapes (see `KnownBankParser.shapes`). */
export const SHAPE_BONUS = 0.05;
/** The highest score a read can keep when it must be checked in Review. */
export const REVIEW_CEILING = 0.75;

// Money not moved yet: a refund or reversal still on its way, a credit that "will reflect".
const NOT_YET =
  /\b(?:refund(?:ed)?\b[^.]{0,40}?\binitiated|initiated\b[^.]{0,40}?\brefund|will\s+(?:be\s+)?(?:credited|reflect(?:ed)?|refunded|reversed|processed)|will\s+reflect|in\s+\d{1,2}(?:\s*-\s*\d{1,2})?\s+(?:working\s+)?days)\b/i;
// A mandate's own notice (set up, changed, revoked) never reaches a bank parser: notices.ts reads it first (ticket 157).
// What is left that names a mandate is either a debit made under it (booked like any debit) or money moved while
// setting it up (a small verification debit or credit), which stays in Review.
const MANDATE = /\b(?:e-?mandate|mandate)\b/i;
const MANDATE_SETUP = /\b(?:registration|register(?:ed)?|set\s?-?up|setup|creat(?:ed|ion)|verification|penny\s+drop|activation)\b/i;
// Characters that may sit inside an amount ("9,125.00") without ending a sentence.
const SAME_SENTENCE = String.raw`(?:[^.]|\.(?=\d))`;
// "Credit Card Services", "Credit Card Solutions Pvt": a business name, not a card.
const CARD = String.raw`credit\s*card(?!\s(?:services?|svcs?|solutions?|ltd|limited|pvt|private|co|company|corp)\b)`;
// Money paid to a credit card: its bill, not a spend or income. Tested only on the sentence holding the amount.
const PAID_TO_CARD = [
  new RegExp(String.raw`\bto\s+(?:[A-Za-z]+\s+){0,3}${CARD}`, "i"),
  /\bcredit\s*card\s+(?:no\.?\s*)?[x*]{0,8}\d{0,4}\s+credited\b/i,
  /\bcredit\s*card\s+(?:bill\s+)?payment\b(?!\s+(?:charges?|fees?)\b)/i,
  new RegExp(String.raw`\btowards\s(?:your\s)?(?:[A-Za-z]+\s){0,4}${CARD}`, "i"),
  /\bInfo\s?BIL\*[^.*]{0,30}?\bcard\b/i,
  new RegExp(String.raw`\bcard\b${SAME_SENTENCE}{0,40}?\bpayment\s+of\b${SAME_SENTENCE}{0,40}?\b(?:received|credited)\b`, "i"),
];
const AMOUNT_TOKEN = /(?:Rs\.?|INR|₹)\s?\d/i;

// A sentence that sells or helps ("Pay your bill ...", "Earn 5% back ..."), never what happened.
const PROMO_START = /^(?:Pay|Earn|Convert|Use|Get|Click|Download)\b/i;
// A card named by its own masked digits ("Credit Card XX6047", "card ending 6047"): the only thing that lets the next
// sentence count, so a promo line ("Now you can pay to your credit card via UPI") never does.
const MASKED_CARD = /\bcard\b[^.]{0,20}?(?:[x*]{2,}\s?\d{4}|ending\s+(?:with\s+)?[x*]*\d{4})\b/i;

/** The sentence that holds the amount and the money verb, plus the sentence right after it when that one names
 * where the money went ("... debited on 03-10-26. Towards HDFC Bank Credit Card XX6047."): it names a card by its
 * masked digits, has no amount and does not start with a promo verb. Promo or help text ("Pay your credit card bill
 * to ...") is never read as what happened. A "." inside an amount, "Rs." or "no." does not end a sentence. */
export function moneySentence(text: string): string {
  const sentences = text.split(/(?<!\b(?:Rs|no|Avl|Bal|Txn|Trxn))\.\s+(?=[A-Z])/);
  let i = sentences.findIndex((s) => AMOUNT_TOKEN.test(s) && (DEBIT_WORDS.test(s) || CREDIT_WORDS.test(s)));
  if (i < 0) i = sentences.findIndex((s) => AMOUNT_TOKEN.test(s));
  if (i < 0) return text;
  const next = sentences[i + 1];
  const namesCard = next && MASKED_CARD.test(next) && !AMOUNT_TOKEN.test(next) && !PROMO_START.test(next.trim());
  return namesCard ? `${sentences[i]}. ${next}` : sentences[i];
}

export abstract class KnownBankParser extends BankParser {
  /** Whole-message shapes this bank sends. Only a match earns the bonus, never the sender alone. */
  protected abstract readonly shapes: readonly RegExp[];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const flat = text.replace(/\s+/g, " ").trim();
    const parse = super.parse(flat, receivedAt);
    if (!parse) return null;
    // Cash from an ATM has no shop, whatever word sits after "on".
    if (parse.atm && parse.merchant) parse.merchant = undefined;
    // A debit under a mandate names the payee after the mandate word ("towards e-mandate STREAMLY"): keep the payee.
    if (parse.merchant) {
      parse.merchant = parse.merchant
        .replace(/^(?:UPI\s|NACH\s)?(?:e-?mandate|mandate|auto\s?-?pay)\s(?!registration|set\s?-?up|creation)(?=\S)/i, "")
        .replace(/^NACH[\s-](?=[A-Za-z])/i, "");
    }
    // A card bill paid from the person's bank account ("debited from A/c XX1234 ... credit card bill"): the type stays
    // income like every card payment (money into the card; ingest queues it as card_payment and never books it), and
    // the digits are only ever the card's own, never the debited account's, so it cannot suggest the wrong account.
    if (parse.cardPayment && !isCardPayment(flat) && this.direction(flat)?.type === "expense") {
      const card = this.paidCard(flat);
      const debited = this.account(flat, "expense");
      // The account found is the card itself ("Your HDFC Bank Credit Card 5150 payment of ..."): keep it.
      const own = debited?.instrument === "card" ? debited : card && card.last4 !== debited?.last4 ? card : null;
      parse.last4 = own?.last4;
      parse.instrument = own ? "card" : undefined;
      // A limit with no card to belong to is nobody's (ticket 156).
      if (!own) delete parse.availableLimitMinor;
    }
    const shaped = this.hasShape(flat);
    // Unsure reads stay in Review: money not moved yet, money moved while setting up a mandate (or a credit naming one),
    // or a message with both a debit and a credit word
    // that is not one of the bank's known shapes.
    const mandateUnsure = MANDATE.test(flat) && (parse.type !== "expense" || !DEBIT_WORDS.test(flat) || MANDATE_SETUP.test(flat));
    const unsure = NOT_YET.test(flat) || mandateUnsure || (!shaped && this.direction(flat)?.ambiguous === true);
    if (unsure && parse.confidence > REVIEW_CEILING) return { ...parse, confidence: REVIEW_CEILING };
    return parse;
  }

  protected hasShape(text: string): boolean {
    return this.shapes.some((re) => re.test(text));
  }

  protected override confidenceBonusFor(text: string): number {
    return this.hasShape(text) ? SHAPE_BONUS : 0;
  }

  /** The bank's own readers run first (in the subclass); a UPI id written with digits is the last resort. */
  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    return sharedParty(super.merchant(text, type)) ?? vpaAfter(type === "expense" ? "to" : "from", text);
  }

  protected override cardPayment(text: string): boolean {
    if (super.cardPayment(text)) return true;
    // A spend with a card, or money coming back, is never a bill payment, whatever promo text follows it.
    if (/\b(?:spent|refund(?:ed)?|cashback|reversal|reversed)\b/i.test(text)) return false;
    const sentence = moneySentence(text);
    return PAID_TO_CARD.some((re) => re.test(sentence));
  }
}

/** Words that start a help line or a non-party, never a payee ("To dispute call 1800...", "mobile x5521"). */
const NOT_A_PARTY =
  /^(?:dispute|call|report|block|receive|clearing|reissue|mobile\s+x?\d+|an\s+a\/c|the\s+beneficiary|transfer\s+of|IST)(?=[\s.,;:]|$)|^merchant$/i;
/** A masked number or an account, never a payee ("XX4410", "A/c 5150"). */
const ACCOUNT_LIKE = new RegExp(
  String.raw`(?:^|\s)[x*]{2,}\d+\b|\bac\s?x+\d|\b(?:a\/c|acct|account)\b|\b${CARD}\b|\b(?:rs|inr)\.?\s?\d|^[\d\s.,-]+$`,
  "i"
);

/** Trims dots, stars and dashes a bank pads a name with, and a terminal code at the end ("AMAZON 000"). */
export function cleanParty(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw
    .slice(0, 80)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^at\s+/i, "")
    .replace(/^[.*:\- ]{1,10}/, "")
    .replace(/[ .*\-]{1,10}$/, "")
    // A terminal code: three or more digits starting with 0. "STORE 24" and "SHOP 247" keep their numbers.
    .replace(/\s0\d{2,}$/, "")
    .trim();
  if (v.length < 2 || !/[A-Za-z]/.test(v) || NOT_A_PARTY.test(v) || ACCOUNT_LIKE.test(v)) return undefined;
  return v.slice(0, 60);
}

/** "debited by Rs 260.00 on 03-11-26; LAKESIDE BAKERY credited." : the payee named before "credited". */
export function creditedParty(text: string): string | undefined {
  const m = text.match(/;\s?([^;.\s][^;.]{1,58}?)\s(?:is\s)?credited\b/i);
  return cleanParty(m?.[1]);
}

// Payment rails and codes a bank writes before the name ("ACH*", "NEFT-", "BIL*").
const RAIL = /^(?:N?ACH|ECS|BIL|INF|UPI|IMPS|NEFT|RTGS|MMT|POS|CMS|BBPS|SI|ATM)$/i;

/** "ACH*SOME POWER LTD*437", "NEFT-ABCD0123456789-ASHA RAO", "BIL*Car Loan": the first part that is a name. */
export function railParty(info: string | undefined): string | undefined {
  if (!info) return undefined;
  const parts = info
    .slice(0, 120)
    .split(/[*/]/)
    // "NEFT-<ref>-<name>" splits on its dashes; a name with a dash ("BD-ACHKFL") stays whole.
    .flatMap((p) => (/^\s*(?:NEFT|IMPS|RTGS|UPI)-/i.test(p) ? p.split("-") : [p]))
    .map((p) => p.trim())
    .filter((p) => p && !RAIL.test(p) && !/\d{3,}/.test(p) && /[A-Za-z]{2}/.test(p));
  return cleanParty(parts[0]);
}

/** A UPI id the money went to or came from, digits and all ("to 98xxxxxx01@paytm"). */
export function vpaAfter(word: "to" | "from", text: string): string | undefined {
  const m = text.match(new RegExp(String.raw`\b${word}\s(?:VPA\s)?([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30}(?:\.[\w\-]{1,30}){0,3})(?![\w@])`, "i"));
  return m?.[1];
}

/** The shared merchant guess, minus help-line text and account numbers it sometimes picks up. */
export function sharedParty(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && /[A-Za-z]/.test(v) && !NOT_A_PARTY.test(v) && !ACCOUNT_LIKE.test(v) ? value : undefined;
}

/** The account named right before the verb that matches the money's direction: "a/c no. XXXX5408 is debited ... and
 * a/c XXXX9921 credited" gives 5408 for an expense and would give 9921 only for income. Ticket 156 review. */
export function verbAccount(text: string, type: "income" | "expense"): FoundAccount | null {
  // A loan or card account is never the person's own bank account: its digits would teach account matching a
  // number that belongs to the loan.
  const re = /(?<!\b(?:loan|card)\s)\b(?:a\/c|acct|account)(?:\s?no\.?)?\s?[x*]{1,12}(\d{4})\s(?:is\s|has\sbeen\s|was\s)?(debited|credited)\b/gi;
  const want = type === "expense" ? "debited" : "credited";
  for (const m of text.matchAll(re)) if (m[2].toLowerCase() === want) return { last4: m[1], instrument: "account" };
  return null;
}

/** A payee name: starts with a non-space, at most 60 characters, never across a sentence end. */
export const NAME = String.raw`(\S[^.;]{0,58}?)`;
