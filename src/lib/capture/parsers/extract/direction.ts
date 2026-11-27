// Which way money moved: debit or credit words, a card bill payment, an ATM withdrawal.

// "debit" as a noun only in SBI's "has a debit by transfer" (a plain "debit of Rs 499 is scheduled" is a notice, not
// money that moved); Dr / Cr only right before an amount.
// "will be debited", "scheduled to be debited": a notice, never a debit.
export const DEBIT_WORDS =
  /(?<!\b(?:will|to|shall)\s+be\s+)\b(debited|debit(?=\s+by\s+transfer)|spent|paid|sent|withdrawn|withdrawal|wdl|purchase|transferred|deducted|payment of|txn of|used|dr(?=\.?\s*(?:Rs|INR|₹|\d)))\b/i;
export const CREDIT_WORDS =
  /(?<!\b(?:will|to|shall)\s+be\s+)\b(credited|(?<!\b(?:request|mandate)\s+(?:has\s+been\s+|is\s+|was\s+)?)received|deposited|refund(?:ed)?|reversed|cashback of|cr(?=\.?\s*(?:Rs|INR|₹|\d)))\b/i;

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
const NOT_A_REPAYMENT =
  /\bdisburs|\bloan\s+amount\b|\b(?:transferred|credited|paid)\s+(?:to|in|into)\s+your\s+(?:savings\s+)?(?:a\/c|acct|account)\b|\b(?:cashback|subvention|interest|subsidy)\b/i;

export function findDirection(text: string): FoundDirection | null {
  // Unsure which account paid unless the message says it was debited: then it is checked in Review.
  if (LOAN_CREDITED.test(text) && !NOT_A_REPAYMENT.test(text)) return { type: "expense", ambiguous: !DEBIT_FROM_ACCOUNT.test(text) };
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
