// The other party of a payment, and its reference number.

// A "." ends a merchant when a space, the end or a known tail word follows it ("AMAZON.Avl Lmt"), so a VPA like
// rahul.k@okaxis or a domain like NETFLIX.COM stays whole.
const MERCHANT_RE =
  /\b(at|to|from|towards|by|VPA|Info:?|trf to|paid to)\s+([A-Za-z0-9@._&*'/ -]{2,40}?)(?=\s+(?:on|ref|refno|ref\.?\s*no|via|at|from|to|by|a\/c|acct|avl|avbl|upi|dt|date|has|have|is|was|been|sms|\d{1,2}[-/])\b|\.(?=\s|$|(?:avl|avbl|bal|ref|info|not|txn|upi|call|sms|rs|inr|ur|your|thanks?|thank\s*you|dear|for)\b)|[,;(]|$)/gi;

/**
 * The other party. For a debit that's who was paid ("to", "at", "VPA"); for
 * a credit, who paid ("from", "by"). Candidates that are the account
 * holder's own account ("from HDFC Bank A/C *1234") are skipped.
 */
export function findMerchant(text: string, type: "income" | "expense"): string | undefined {
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

export function findRef(text: string): string | undefined {
  const match = text.match(
    /\b(?:UPI\s*Ref(?:\.|erence)?(?:\s*No)?|Ref(?:erence)?\.?\s*(?:No|Number|ID)?|RRN|UTR|Txn\s*(?:ID|No)|IMPS\s*Ref)[\s:.#-]*([A-Za-z0-9]{6,22})\b/i
  );
  return match?.[1];
}
