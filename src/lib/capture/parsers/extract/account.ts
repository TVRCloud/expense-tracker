// The person's own account or card: its last four digits, and which bank wrote the message.

export interface FoundAccount {
  last4: string;
  instrument: "card" | "account";
}

export function findLast4(text: string, type?: "income" | "expense"): FoundAccount | null {
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
  // The first bare mask that is not a loan's number ("loan account XX6618"): a loan is never the person's own account.
  for (const bare of text.matchAll(/\b[xX*]{2,}(\d{4})\b/g)) {
    const before = text.slice(Math.max(0, (bare.index ?? 0) - 24), bare.index);
    if (/\bloan\s+(?:a\/c|acct|account)(?:\s*no\.?)?\s*$/i.test(before)) continue;
    // A reference number written as a mask ("ref XX5163", "RRN XX1234") is never an account (ticket 177).
    if (/\b(?:ref(?:erence)?(?:\s*no\.?)?|rrn|utr|txn\s*id)[\s:.#-]*$/i.test(before)) continue;
    return { last4: bare[1], instrument: /card/i.test(text) ? "card" : "account" };
  }
  return null;
}

/** The card a bill payment went to ("towards your credit card XX1234"). */
export function findPaidCard(text: string): FoundAccount | null {
  // The card the payment went to ("… payment towards Credit Card XX5678"), before any card that paid it.
  const to = text.match(/\b(?:to|towards)\s(?:your\s)?(?:[A-Za-z]+\s){0,4}?credit\s*card\b[^\d]{0,24}?(?:[x*]+|ending(?:\s+with)?\s*[x*]*|no\.?\s*[x*]*)\s*(\d{4})\b/i);
  if (to) return { last4: to[1], instrument: "card" };
  const m = text.match(/\bcard\b[^\d]{0,24}?(?:[x*]+|ending(?:\s+with)?\s*[x*]*|no\.?\s*[x*]*)\s*(\d{4})\b/i);
  return m ? { last4: m[1], instrument: "card" } : null;
}

export function findBankName(text: string): string | undefined {
  const match = text.match(
    /\b(HDFC|ICICI|SBI|Axis|Kotak|IDFC(?: FIRST)?|Yes|IndusInd|PNB|Bank of Baroda|BOB|Canara|Union|Federal|AU|RBL)\b\s*(Bank)?/i
  );
  return match ? `${match[1]}${match[2] ? " Bank" : ""}` : undefined;
}
