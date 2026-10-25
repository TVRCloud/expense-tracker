# API: accounts
Purpose: account CRUD and balance recalculation.

## Files
- route.ts: list and create. [id]/route.ts: get, patch, delete (archives).
- [id]/recalculate/route.ts: recomputes the balance from transactions, leaving out history rows (`balanceApplied: false`, which never moved it).

## Talks to
- Libs: account-service (create, update, archive, shared with the integration routes), ledger. Models: Account, Transaction.
- UI: src/features/accounts, src/features/credit-cards. Mobile twin: `/api/integrations/accounts` (GET, POST) and `.../[id]` (PATCH, DELETE).

## Rules and gotchas
- DELETE sets `isArchived`, `deletedAt`, `deletedBy`; no hard delete. Every change appends a ledger block.
- PATCH has no `balance` field on purpose; balance is the opening value on create, then only transactions move it.
- Recalculate counts only paid recurring installments; transfers move both sides.
- `smsLastFour` (array of 4-digit strings) is accepted for capture matching.

## Tests
- `src/test/integrations.test.ts` (integration account create, edit and archive).

## Last changed
- e08c36f app support
