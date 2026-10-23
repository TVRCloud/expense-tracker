# API: accounts
Purpose: account CRUD and balance recalculation.

## Files
- route.ts: list and create. [id]/route.ts: get, patch, delete (archives).
- [id]/recalculate/route.ts: recomputes the balance from transactions.

## Talks to
- Libs: ledger. Models: Account, Transaction.
- UI: src/features/accounts, src/features/credit-cards. Mobile twin: `GET /api/integrations/accounts`.

## Rules and gotchas
- DELETE sets `isArchived`, `deletedAt`, `deletedBy`; no hard delete. Every change appends a ledger block.
- Recalculate counts only paid recurring installments; transfers move both sides.
- `smsLastFour` (array of 4-digit strings) is accepted for capture matching.

## Tests
- None specific.

## Last changed
- e08c36f app support
