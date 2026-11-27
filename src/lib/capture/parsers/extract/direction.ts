// Which way money moved: debit or credit words, a card bill payment, an ATM withdrawal.

// "debit" as a noun only in SBI's "has a debit by transfer" (a plain "debit of Rs 499 is scheduled" is a notice, not
// money that moved); Dr / Cr only right before an amount.
// "will be debited", "scheduled to be debited": a notice, never a debit.
export const DEBIT_WORDS =
  /(?<!\b(?:will|to|shall)\s+be\s+)\b(debited|debit(?=\s+by\s+transfer)|spent|paid|sent|withdrawn|withdrawal|wdl|purchase|transferred|deducted|payment of|txn of|used|dr(?=\.?\s*(?:Rs|INR|₹|\d)))\b/i;
export const CREDIT_WORDS =
  /(?<!\b(?:will|to|shall)\s+be\s+)\b(credited|(?<!\b(?:request|mandate)\s+(?:has\s+been\s+|is\s+|was\s+)?)received|deposited|refund(?:ed)?|reversed|cashback of|cr(?=\.?\s*(?:Rs|INR|₹|\d)))\b/i;

/** A card spend written with no money verb (ticket 177): "Thank you for using HSBC Credit Card XXXX6603 for INR 845.00
 * … at SHOP", "You have used your card XX1234 for Rs 500 at …". Needs a card mask with digits or an "at <shop>", so a
 * promo ("Thank you for using your Credit Card for Rs 1,00,000 worth of spends this year!") is not one. */
const CARD_USE_SHAPE =
  /\b(?:thank\s*you\s+for\s+using|(?:have|has)\s+used|used)\s+(?:your\s+)?(?:[A-Za-z&]{1,15}\s+){0,4}?(?:(?:credit|debit)\s+)?card\b([^.\n]{0,40}?)\bfor\s+(?:INR|Rs\.?|₹)\s?[\d,]+(?:\.\d{1,2})?([^.\n]{0,60})/i;
const CARD_MASK = /(?:[x*]{2,}\s?\d{3,4}|\b\d{2}[x*]{2}\b|\bending\s+(?:with\s+)?[x*]*\d{4}|\b\d{4}\b)/i;
export function isCardUse(text: string): boolean {
  const m = CARD_USE_SHAPE.exec(text);
  if (!m) return false;
  if (/\bworth\s+of\s+spends?\b|\bthis\s+(?:year|month)\b/i.test(m[2])) return false;
  return CARD_MASK.test(m[1]) || /\bat\s+\S/i.test(m[2]);
}

export const MONEY_UNDONE =
  /\b(?:revers\w*|revert(?:ed)?|refund\w*|reimburs\w*|charge-?back\w*|charged\s+back|cancel(?:l?ed|lation)|void(?:ed)?|bounced|returned|rolled\s+back|adjusted\s+back|re-?credited|credited\s+back)\b/i;

/** The attempt itself did not go through, said in the sentence holding the amount or as a sentence about the
 * transaction ("… has been declined.", "Txn declined due to incorrect PIN.", "Txn unsuccessful."). A help line ("to get
 * any failed or disputed txn checked", "Txn declined? Call 1800…") is not one. Ticket 177. */
export function txnDidNotGoThrough(text: string): boolean {
  const sentences = text.split(/(?<!\b(?:Rs|no|Avl|Bal|Txn|Trxn))[.!]\s+|[\n]/);
  return sentences.some(
    (x) =>
      !/\?/.test(x) &&
      (/\b(?:txn|transaction|payment|attempt)\b[^.?!]{0,60}?\b(?:(?:was|has\s+been|is|got)\s+)?(?:declined|failed|unsuccessful|not\s+successful)\b/i.test(x) ||
        (/(?:Rs\.?|INR|₹)\s?\d/i.test(x) && /\b(?:was|has\s+been|is|got)\s+declined\b/i.test(x)))
  );
}

export interface FoundDirection {
  type: "income" | "expense";
  ambiguous: boolean;
}

// Money into a loan ("Your loan account XX6618 is credited ... by debit to A/c XX7305", "EMI ... credited to your loan
// account"): it left the person's own account, so it is spending from that account, never income. A disbursal (the
// loan paying out to the person) is the other way round and keeps the usual reading.
const LOAN_CREDITED =
  /\bloan\s+(?:a\/c|acct|account)(?:\s*no\.?)?\s*[x*]{0,12}\d{0,16}\s+(?:is\s+|has\s+been\s+|was\s+)?credited\b|\bcredited\s+(?:to|in|into|towards)\s+(?:your\s+)?loan\s+(?:a\/c|acct|account)\b/i;
const DEBIT_FROM_ACCOUNT =
  /\b(?:by\s+(?:NACH\s+|ECS\s+|auto\s?-?)?debit\s+(?:to|from|of)|debited\s+(?:from|to))\s+(?:your\s+)?(?:[A-Za-z]{2,15}\s+){0,3}?(?:a\/c|acct|account)\b/i;
// The loan paying out or being topped up by someone else: a disbursal ("being loan amount ... transferred to your
// a/c"), cashback, subvention, interest or a subsidy. Those keep the usual reading.
const PAID_OUT =
  /\bdisburs|\bloan\s+amount\b|\b(?:transferred|credited|paid)\s+(?:to|in|into)\s+your\s+(?:savings\s+)?(?:a\/c|acct|account)\b/i;
// Interest, cashback, subvention or a subsidy as the thing credited ("Interest of Rs 115 credited ...").
// Only as the subject of its own "credited" sentence, so an EMI's "(principal Rs 1,980, interest Rs 335)" or a
// closing "Interest Rs 315." is not one.
const TOP_UP_SUBJECT =
  /(?:^|[.;!]\s{1,3})(?:an?\s|your\s)?(?:[A-Za-z]{2,15}\s)?(?:interest|cashback|subvention|subsidy)\s(?:of\s|amount\s(?:of\s)?)?(?:Rs\.?|INR|₹)[^.;!]{0,60}?\bcredited\b/i;
const TOP_UP_WORD = /\b(?:cashback|subvention|interest|subsidy)\b/i;
// An EMI or a prepayment names interest as a part of it ("EMI incl. interest"): still a repayment.
const REPAYMENT_WORD = /\b(?:EMI|repayment|re-?payment|prepayment|part-?prepayment|instal(?:l)?ments?|foreclosure)\b/i;
function notARepayment(text: string): boolean {
  // A payout, or interest, cashback, subvention or a subsidy as the thing credited ("Interest subsidy of Rs 1,200
  // credited ... Your EMI stays the same").
  if (PAID_OUT.test(text) || TOP_UP_SUBJECT.test(text)) return true;
  // An EMI or prepayment, or money debited from the person's account, is a repayment whatever interest it names.
  if (REPAYMENT_WORD.test(text) || DEBIT_FROM_ACCOUNT.test(text)) return false;
  return TOP_UP_WORD.test(text);
}

export function findDirection(text: string): FoundDirection | null {
  // Unsure which account paid unless the message says it was debited: then it is checked in Review.
  if (LOAN_CREDITED.test(text) && !notARepayment(text)) return { type: "expense", ambiguous: !DEBIT_FROM_ACCOUNT.test(text) };
  // A card used for an amount is a spend; a refund named in the same message makes it one to check (ambiguous).
  // Only money that came back makes it unsure; a cashback promo or a shop named "CREDITED BAKEHOUSE" does not.
  if (isCardUse(text)) return { type: "expense", ambiguous: MONEY_UNDONE.test(text) };
  const debit = text.search(DEBIT_WORDS);
  const credit = text.search(CREDIT_WORDS);
  if (debit === -1 && credit === -1) return null;
  if (debit === -1) return { type: "income", ambiguous: false };
  if (credit === -1) return { type: "expense", ambiguous: false };
  // Both appear ("debited from your a/c ... credited to VPA x"): the first
  // verb is about the account holder's own account.
  return { type: debit < credit ? "expense" : "income", ambiguous: true };
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
    // "Payment of Rs 12,000 towards your SBI Credit Card XX5678 using your Debit Card", "… for Rs 12,000 payment towards
    // Credit Card XX5678": money to a card's bill, whatever card or account paid it (ticket 177).
    String.raw`\bpayment\b${any}{0,60}?\b(?:to|towards)\s+(?:your\s+)?(?:(?!using\b|via\b|with\b|by\b)[A-Za-z]+\s+){0,3}?credit\s*card\s+(?:no\.?\s*)?(?:[x*]{2,8}\s?\d{4}|ending)`,
    String.raw`\b(?:to|towards)\s+(?:your\s+)?(?:(?!using\b|via\b|with\b|by\b)[A-Za-z]+\s+){0,3}?credit\s*card\s+(?:no\.?\s*)?(?:[x*]{2,8}\s?\d{4}|ending)${any}{0,40}?\bpayment\b`,
    // "Rs 4,180 debited from A/c XX7305 towards HDFC Bank Credit Card XX2614", "… towards credit card bill", "Paid to Axis
    // Bank Credit Card XX2208": money from the person's account to a card's bill (ticket 177).
    String.raw`\b(?:debited|paid|transferred|sent|debit)\b${any}{0,100}?\b(?:to|towards)\s+(?:your\s+)?(?:(?!using\b|via\b|with\b|by\b)[A-Za-z]+\s+){0,3}?credit\s*card\s+(?:no\.?\s*)?(?:[x*]{2,8}\s?\d{4}|ending|bill)`,
    String.raw`\bcredit\s*card\s+(?:bill\s+)?payment\s+(?:[x*]{2,8}\s?\d{4})`,
    String.raw`(?:^|[.;]\s)(?:(?:paid|payment)\s+(?:to|towards)|towards)\s+(?:your\s+)?(?:(?!using\b|via\b|with\b|by\b)[A-Za-z]+\s+){0,3}?credit\s*card\s+(?:no\.?\s*)?(?:[x*]{2,8}\s?\d{4}|ending|bill)`,
    // "Acct XX274 debited ...; ICICI Bank Credit Card XX3391 credited.": the bill of the person's own card (ticket 177).
    String.raw`\bcredit\s*card\s+(?:no\.?\s*)?[x*]{2,8}\s?\d{4}\s+(?:is\s+|has\s+been\s+)?credited\b`,
    spendWithCard ? null : String.raw`\bthank\s*you\s+for\s+(?:the\s+|your\s+)?payment\b${any}{0,80}?${card}`,
  ].some((re) => re !== null && new RegExp(re, "i").test(text));
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
