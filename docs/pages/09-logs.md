# Logs

`/logs`

**User story**
> As a user (or an admin auditing my own data), I want a tamper-evident record of every change made to my finances, protected behind a second-factor unlock, so I can prove nothing was silently altered.

**What happens here**
A hash-chained audit ledger. First-time access requires setting up a TOTP authenticator
(QR code + secret), which produces one-time recovery codes shown exactly once. After
that, unlocking is device-scoped (per-browser session). Once unlocked, every
create/update/delete across transactions, accounts, budgets, goals, loans, repayments,
and credit statements is listed and searchable, with a one-click chain-integrity check.

**Key elements**
- Setup panel: QR code + secret, code verification, one-time recovery codes (with copy)
- Scope filter chips: All / Transactions / Accounts / Budgets / Goals / Loans / Repayments / Statements
- Search
- Ledger rows: sequence, scope, action, expandable before/after JSON, truncated hash / previous-hash
- "Verify" action — walks the chain, reports the first broken sequence if the chain was tampered with

**Edge cases to design for**
- Lost authenticator + no recovery codes saved (locked out — what's the recovery path?)
- A very long ledger (pagination/virtualization)
- Chain verification actually failing — this should look alarming, not like a normal error toast

**Source:** `src/features/logs/components/LogsClient.tsx`
