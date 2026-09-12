# Loans

`/loans`

**User story**
> As a user, I want to track money I've lent to or borrowed from someone — with interest and a due date — and log repayments over time, so informal loans don't get forgotten.

**What happens here**
Tabs split loans into All / Lent / Borrowed. Each loan card shows the counterparty,
principal, interest rate, due date, and linked account. Repayments are logged against
the loan and a progress bar tracks how much is left.

**Key elements**
- Direction tabs: All / Lent / Borrowed
- Add-loan form: direction, counterparty, principal, interest rate, start/due date, account, note
- Optional "Loan account number" field (Borrowed loans only) — the lender's own loan/account number from an EMI SMS (e.g. "loan account 010021753351"). When set, `POST /api/integrations/sms` auto-matches incoming EMI-payment SMS to this loan and logs a repayment automatically — see [docs/n8n-integration.md](../n8n-integration.md).
- Repayment entries (income/expense icons), progress bar toward full repayment
- Edit/delete (confirm dialog)

**Edge cases to design for**
- Loan overdue (past due date, not fully repaid)
- Partial repayments over many entries (how the history reads at a glance)
- Interest-bearing loan — is the accruing interest shown anywhere before repayment?

> **Not linked from Sidebar, BottomNav, or Dashboard.** Only reachable via the command palette (⌘K/Ctrl+K → "Loans") or a loan-due notification deep-link.

**Source:** `src/features/loans/components/LoansClient.tsx`
