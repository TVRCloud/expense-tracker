# API: integrations
Purpose: API-key surface for n8n and the Android companion app. Contracts: [docs/n8n-integration.md](../../../../docs/n8n-integration.md), [docs/reconcile.md](../../../../docs/reconcile.md), [docs/realtime.md](../../../../docs/realtime.md).

## Files
- accounts (GET with card details, SMS digits and `isArchived`, `?includeArchived=true`; + POST, `[id]` PATCH, DELETE), summary, home, spend-limit (GET, PUT: daily and weekly limit), transactions (+ `[id]`, recurring list, series get and cancel, installment status), budgets and goals (+ `[id]` PATCH, DELETE): reads and writes over the shared services.
- credit-cards/summary and credit-cards/[accountId]/statements: read-only card dues and statements. credit-cards/rewards (GET) and credit-cards/[accountId]/rewards (GET, PUT, DELETE with `Idempotency-Key`): reward rule and the earned estimate per billing cycle.
- forecast (GET `?days`): cash flow forecast over cash-flow-forecast.ts; read-only. `src/app/api/forecast` is the browser twin.
- bills (GET list, `[id]/pay` POST, `settings` GET PATCH): upcoming bills and reminder settings over bills.ts.
- weekly-review (GET one week's look back, `settings` GET PATCH): over weekly-review.ts.
- loans (+ `[id]`, `[id]/repayments`): loan CRUD and repayments over loan-service.
- transfers (POST, `[id]` GET PATCH DELETE): money between own accounts over transfer-service. `transactions` GET also takes `includeIncomingTransfers`.
- rules (+ `[id]`, `test`): categorise rules over rule-service; `test` is a read-only dry run.
- cash (GET, POST): the cash account and its low-cash view over cash-service; POST makes sure the account exists. ATM withdrawal captures become transfers to it.
- captures, sms: bank message ingest (phone app, n8n). review/*: phone review inbox, confirm, correct, resolve, discard, history.
- subscriptions (GET detected repeating charges, `[id]` PATCH confirm or dismiss) over subscription-service.
- net-worth (GET report with trend, `assets` GET POST, `assets/[id]` PATCH DELETE): net worth and manual assets over net-worth.ts.
- refunds (GET suggestions, `[id]/confirm` and `[id]/reject` POST): refund and reversal matching over refund-service.
- sinking-funds (GET, POST, `[id]` GET PATCH DELETE, `[id]/contribute` POST) and savings-rate (GET): money set aside for a cost on a due date, and the share of income saved, over sinking-fund-service and savings-rate.
- transactions/tags (GET), transactions/[id]/splits (GET, PUT), transactions/[id]/receipts (GET list, POST raw image), receipts/[id] (GET image, DELETE): tags, split edits and receipt photos over tags.ts, split-service and receipt-service. Receipt image bytes use plain headers, not the JSON envelope.
- tax (GET financial-year summary, `export` GET csv, `settings` GET PUT, `transactions/[id]` PATCH deductible flag) over tax-service.
- backup (POST: passphrase-encrypted file of the caller's data) and backup/restore (POST: dry run or merge-only restore, `Idempotency-Key` unless dry run); passphrase in the body, never logged. See [docs/backup.md](../../../../docs/backup.md).
- export/transactions (GET a CSV file) and import/preview, import/commit (POST a CSV, dry run then write, commit needs `Idempotency-Key`): over transaction-export.ts and transaction-import.ts.
- currencies (GET supported currencies, base and rates; PATCH base while there are no transactions): over currency.ts, exchange-rate-service and base-currency. `transactions` POST also takes `originalAmount`, `originalCurrency`, `rate` for foreign spend.
- stats (month totals, daily, history) and notifications (list, `[id]` PATCH, read-all POST).
- events (SSE), changes (`?since=` polling): realtime for the app.
- app-update, app-update/download: newest Android release and a signed APK URL.

## Talks to
- Libs: src/lib/integrations/* (auth, handler, idempotency, rate-limit, response), capture/ingest, reconcile/*, transaction-service, stats-service, budget-service, goal-service, subscription-service, app-update, realtime/*.
- Models: ApiKey, IdempotencyRecord, CapturedMessage, Transaction and the rest via services.
- Mobile: lib/core/api/review_api.dart calls these routes.

## Rules and gotchas
- Every route is wrapped in `withIntegrationRoute(name, handler)`: request id, Bearer auth, per-key rate limit, safe logging.
- Responses use `{success, data | error{code,message}, requestId}`, not the browser's `{data}` / `{error}`.
- Mutations need an `Idempotency-Key`. The unique index on (userId, endpoint, key) is the only concurrency guard; a reused key with a different body is `IDEMPOTENCY_CONFLICT` (409).
- Capture dedupe does not use that cache; it uses the permanent content hash on `captured_messages`.
- `src/proxy.ts` exempts `/api/integrations`, so auth here is only the API key.
- Keys: `etk_` prefix, sha256 stored, max 10 live per user. Plain SHA-256 is intentional (random 256-bit tokens).

## Tests
- `src/test/integrations.test.ts`; `src/lib/realtime/*.test.ts`.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
