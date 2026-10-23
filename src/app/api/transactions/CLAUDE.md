# API: transactions
Purpose: browser CRUD, stats, recurring series and reconcile actions for transactions.

## Files
- route.ts: list (`GET`, filters, `?format=csv`, `?splitGroupId=`) and create.
- [id]/route.ts: get, patch, delete. [id]/confirm, [id]/corrections: reconcile actions.
- stats, stats/range: month totals and multi-month totals.
- recurring/*: series list (`?upcoming=`), series get and delete, installment status patch (list, get and cancel logic is in `src/lib/recurring-series.ts`).

## Talks to
- Libs: transaction-service (create/update), transaction-query (list), stats-service, ledger, reconcile/correct and inbox, emi-notifications, csv, redis.
- Models: Transaction, Account.
- Mobile twin: `/api/integrations/transactions` (same services, different auth and envelope).

## Rules and gotchas
- Put logic in src/lib/transaction-service.ts or transaction-query.ts, never in the route, so n8n and the app stay equal.
- Writes are not atomic: no mongoose sessions are used in this codebase.
- Locked rows (statement, loan, recurring links) throw `TRANSACTION_LOCKED`.
- Stats are Redis cached; invalidate with `invalidateStatsCacheMany` after writes.
- Stats count recurring installments only once paid.
- Corrections: [docs/reconcile.md](../../../../docs/reconcile.md).

## Tests
- `src/test/integrations.test.ts` (createTransaction, capture ingest and reconcile).

## Last changed
- a2b12d4 perf(web): server-render the dashboard's first data, paint at once
