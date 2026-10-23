# Transactions
Purpose: list, filter, add, view, edit and delete income, expense and transfer entries. Page spec: [docs/pages/02-transactions.md](../../../docs/pages/02-transactions.md).

## Files
- components/TransactionsClient.tsx: `/transactions` list with debounced search, filters, paging.
- components/AddTransactionForm.tsx: `/transactions/add`, incl. recurrence, split and transfer.
- components/TransactionDetailClient.tsx: `/transactions/[id]`, includes provenance from reconcile.
- components/TransactionRow.tsx, DayGroup.tsx, FilterChips.tsx: list pieces.
- hooks/useTransactions.ts: query `["transactions", filters]`, keeps previous rows while paging.
- utils/activity-date.ts: client copy of the activity-date rule; compare with src/lib/transaction-activity.ts before changing either.

## Talks to
- `GET/POST /api/transactions` (`?format=csv`), `GET/PATCH/DELETE /api/transactions/:id`; split rows via `?splitGroupId=`.
- Models: Transaction, Account. Server: src/lib/transaction-service.ts, transaction-query.ts.
- Mobile: Activity tab; `GET/POST/PATCH/DELETE /api/integrations/transactions`.

## Rules and gotchas
- Create and update logic is shared with the integration routes in `transaction-service.ts`; do not copy it into a route.
- Linked rows (statement, loan, recurring) are locked (`TRANSACTION_LOCKED`).
- Amounts are integer cents. No mongoose sessions are used, so writes are sequential, not atomic.

## Tests
- `src/test/integrations.test.ts` (createTransaction, POST /api/integrations/transactions).

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
