// IndusInd Bank. A UPI debit names the payee after "towards" ("debited by Rs X towards <UPI id>"); an account is
// often written with its first digits shown and the middle masked ("A/C 201***046152", "Account 15XXXXX6152"); an
// ACH debit names the payee after the last "/" before ".Bal"; deposit interest is "paid on your ... Deposit": money
// in, not out.

import type { FoundAccount } from "../extract/account";
import type { FoundDirection } from "../extract/direction";
import type { MoneyParse } from "../types";
import { cleanParty, REVIEW_CEILING, sharedParty } from "./known";
import { hasMaskedNumber, scrubParty } from "./party-scrub";
import { PrivateBankParser } from "./private-base";

const DEPOSIT_INTEREST = /\binterest\s(?:INR|Rs\.?)\s?[\d,.]{1,15}\spaid\son\syour\s[^.]{0,30}?\bDeposit\b/i;
// Tax taken from deposit interest is money out, never interest paid in.
const TAX = /\bTDS\b|\bdeducted\b/i;
// Money moved into the person's own RD, FD or deposit from their savings account: out of the savings account.
// "RD", "FD" or "Deposit", with one word in front when spelled out ("Recurring Deposit", "Fixed Deposit").
const DEPOSIT_WORD = String.raw`(?:[A-Za-z]{2,10}\s)?(?:RD|FD|Deposit)`;
const FUNDS_DEPOSIT = new RegExp(
  String.raw`\b${DEPOSIT_WORD}\s(?:A\/C|Account)\s[\dX*]{4,20}\s(?:has\sbeen\s|is\s)?credited\b|\bcredited\sto\s(?:your\s)?${DEPOSIT_WORD}\b`,
  "i"
);
const FROM_SAVINGS =
  /\bby\sdebit\s(?:to|from)\s(?:your\s)?(?:Savings\s)?A\/C\b|\bfrom\s(?:your\s)?(?:Savings\s)?(?:A\/C|Account)\s\d{0,4}[X*]{2,10}\d{2,8}\b/i;
// A loan account credited with the money ("Your Loan A/C 450***009904 is credited with INR X"): a repayment.
const LOAN_CREDITED =
  /\bLoan\s(?:A\/C|Account)\s[\dX*]{4,20}\s(?:has\sbeen\s|is\s)?credited\b|\bcredited\sto\s(?:your\s)?(?:[A-Za-z]{2,10}\s)?Loan\s(?:A\/C|Account)\b/i;
// Every account number the message names, star-masked ("A/c *XX7731") or partly shown ("A/C 159***007731",
// "Account 15XXXXX7731"), with the word before it.
const ACCOUNT_MASK = /(\b[A-Za-z]{2,14}\s)?(?:A\/C|Account)\s(?:no\.?\s)?\*?(\d{0,4}[X*]{2,10}\d{0,4}?(\d{4}))\b/gi;
// A loan, card, deposit, RD or FD account: never the person's spending account, and not counted.
const NOT_OWN = /^(?:loan|card|deposit|FD|RD)\s$/i;
const DEPOSIT_LABEL = /^(?:deposit|FD|RD)\s$/i;
const LOAN_LABEL = /^loan\s$/i;
// The other party's account: labelled so ("Beneficiary A/C", "Payee Account"), or after a bare "to"/"from" ("sent to
// A/C ...", "received from A/C ...") that is not the person's own account moving ("debited from A/C", "by debit to
// A/C", "credited to your A/C").
const OTHER_LABEL = /^(?:beneficiary|benef|payee|remitter)\s$/i;
const BARE_TO_FROM = /^(?:to|from)\s$/i;
// The verb before a bare "from" or "to" says whose account it is: money leaves the person's account "from" it
// ("debited from A/C"), and reaches it "to/in/into" it ("credited to A/C"), except "by debit to A/C" (taken from it).
// "transferred to", "sent to", "paid to", "IMPS to" name the other party.
const OWN_BEFORE_FROM = /\b(?:debited|debit|withdrawn|deducted|recovered|transferred)\s$/i;
// "by debit to A/C" is the account the money was taken from, so the person's own too.
const OWN_BEFORE_TO = /\b(?:credited|deposited)\s$|\bby\sdebit\s$/i;
// Money put into a numbered account "from your (IndusInd) account" with no number: a transfer between accounts whose
// direction for this bank is not certain ("INR X deposited to A/C 50XX4421 from your IndusInd account").
const INTO_FROM_YOUR_ACCOUNT =
  /\b(?:credited|deposited)\s(?:to|in|into)\s(?:A\/C|Account)\s[\dX*]{4,20}\b[^.]{0,60}?\bfrom\syour\s(?:IndusInd\s)?(?:a\/c|account)\b(?!\s(?:no\.?\s)?\*?[x*\d])/i;
// A card named in a message that also says which account (with its number) money left or reached is only what it
// was for. "debited from account linked" names no account, so the card stays.
const ACCOUNT_MOVED = /\b(?:debited\sfrom|credited\sto)\s(?:your\s)?(?:a\/c|acct|account)(?:\sno\.?)?\s?\*?[x*\d]/i;
// A card bill paid from the account linked to the card ("debited from your account linked for IndusInd Credit Card
// XX8812 payment").
const LINKED_CARD_BILL = /\bdebited\sfrom\syour\saccount\slinked\b[^.]{0,40}?\bCredit\sCard\sXX\d{4}\spayment\b/i;
// A sentence that sells or helps ("Pay bills from your A/C ...", "Now pay from your Account ...", "Get cashback when
// ..."): it never adds an account or a verb.
const PROMO = /^(?:Now\s(?:you\s(?:can|may)\s)?)?(?:Pay|Earn|Convert|Use|Get|Click|Download|Enjoy|Try|Open|Apply|send)\b/i;

/** The message without its promo sentences. */
function withoutPromo(text: string): string {
  return text
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .filter((sentence) => !PROMO.test(sentence.trim()))
    .join(" ");
}

/** The account numbers the money could have moved on (the person's own kind), whether another party's account or a
 * loan or deposit account was also named. */
function accounts(text: string): { own: string[]; other: number; deposit: boolean; loan: boolean } {
  const plain = withoutPromo(text);
  const all = [...plain.matchAll(ACCOUNT_MASK)];
  const word = (m: RegExpMatchArray) => m[1] ?? "";
  const otherParty = (m: RegExpMatchArray) => {
    if (OTHER_LABEL.test(word(m))) return true;
    if (!BARE_TO_FROM.test(word(m))) return false;
    // "debited from A/C", "credited to A/C": still the person's own account; any other verb names the other party.
    const before = plain.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
    return !(/^from\s$/i.test(word(m)) ? OWN_BEFORE_FROM : OWN_BEFORE_TO).test(before);
  };
  // Money moved into the person's own loan or deposit comes "from A/C ..." their savings: not another party.
  const ownProduct = all.some((m) => NOT_OWN.test(word(m)) && !/^card\s$/i.test(word(m)));
  const other = (m: RegExpMatchArray) => otherParty(m) && !(ownProduct && /^from\s$/i.test(word(m)));
  const own = all.filter((m) => !NOT_OWN.test(word(m)) && !other(m));
  return {
    own: own.map((m) => m[3]),
    other: all.filter(other).length,
    deposit: all.some((m) => DEPOSIT_LABEL.test(word(m))),
    loan: all.some((m) => LOAN_LABEL.test(word(m))),
  };
}

export class IndusIndParser extends PrivateBankParser {
  readonly id = "indusind";
  readonly bankName = "IndusInd Bank";
  override readonly senderIds = ["INDUSB"];

  protected readonly shapes = [
    /^A\/c\s\*?XX\d{4}\s(?:debited|credited)\sby\sRs\.?\s?[\d,.]{1,15}\s(?:towards|from)\s/i,
    /\bspent\son\sIndusInd\sCard\sXX\d{4}\son\s/i,
    /\bdebited\sfrom\syour\sA\/C\s\d{2,4}\*{2,}\d{4,8}\stowards\sDebit\sCard\sPurchase\b/i,
  ];

  protected override direction(text: string): FoundDirection | null {
    const plain = withoutPromo(text);
    if (DEPOSIT_INTEREST.test(plain) && !TAX.test(plain)) return { type: "income", ambiguous: false };
    // Money moved into the person's RD, FD or deposit from the one savings account the message names.
    const { own, deposit, loan } = accounts(plain);
    if (deposit && own.length === 1 && FUNDS_DEPOSIT.test(plain) && FROM_SAVINGS.test(plain)) return { type: "expense", ambiguous: false };
    // A loan account credited from the one savings account named: a repayment, money out of savings.
    if (loan && own.length === 1 && LOAN_CREDITED.test(plain) && (FROM_SAVINGS.test(plain) || /\bdebited\b/i.test(plain))) {
      return { type: "expense", ambiguous: false };
    }
    return super.direction(plain);
  }

  protected override cardPayment(text: string): boolean {
    return LINKED_CARD_BILL.test(text) || super.cardPayment(text);
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // One account named (loan, card and deposit accounts aside): that is the account. Two or more: no guessing,
    // whatever "your", "from" or "to" says; the message goes to Review (see parse).
    const { own, other } = accounts(text);
    if (own.length === 1) return { last4: own[0], instrument: "account" };
    if (own.length > 1) return null;
    // Only the other party's account is named ("sent to A/C ...", "Beneficiary Account ..."): never take its digits.
    if (other > 0) return null;
    if (DEPOSIT_INTEREST.test(text)) return null;
    const card = ACCOUNT_MOVED.test(text) ? null : text.match(/\bIndusInd\s(?:Credit\s|Debit\s)?Card\sXX(\d{4})\b/i);
    if (card) return { last4: card[1], instrument: "card" };
    return super.account(text, type);
  }

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (!parse || (accounts(text).own.length < 2 && !INTO_FROM_YOUR_ACCOUNT.test(text))) return parse;
    // Two or more accounts of the person's kind in one message, or money moved into a numbered account from "your
    // account": which one moved is not certain, so no account and no balance or limit (they belong to an account),
    // and Review.
    const held: MoneyParse = { ...parse, last4: undefined, instrument: undefined, confidence: Math.min(parse.confidence, REVIEW_CEILING) };
    delete held.balanceMinor;
    delete held.availableLimitMinor;
    return held;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    if (DEPOSIT_INTEREST.test(text) || /\btowards\sDebit\sCard\sPurchase\b/i.test(text)) return undefined;
    const towards = text.match(/\btowards\s([\w.\-]{1,60}@[A-Za-z][\w\-]{0,30})(?![\w@])/i);
    const ach = text.match(/\bACH\sDR\b[^.]{0,80}\/([A-Za-z][A-Za-z0-9 &]{1,40})\.\s?Bal\b/i);
    // The bank's own sign-off is never part of a payee ("SHOPKART - IndusInd Bank").
    const shared = sharedParty(super.merchant(text, type))?.replace(/\s-\s?IndusInd\s?Bank\.?$/i, "");
    // "towards FD closure 410***551203": a name built around an account number is no payee at all.
    // "at HDFC Bank debited from A/C ...": a guess that runs into the verb is the bank, not a payee.
    const usable = shared && !hasMaskedNumber(shared) && !/\b(?:debited|credited)\b/i.test(shared) ? shared : undefined;
    return towards?.[1] ?? scrubParty(cleanParty(ach?.[1])) ?? scrubParty(usable);
  }
}
