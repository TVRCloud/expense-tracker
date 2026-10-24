# API: integrations
Purpose: API-key surface for n8n and the Android companion app. Contracts: [docs/n8n-integration.md](../../../../docs/n8n-integration.md), [docs/reconcile.md](../../../../docs/reconcile.md), [docs/realtime.md](../../../../docs/realtime.md).

## Files
- accounts (GET with card details, SMS digits and `isArchived`, `?includeArchived=true`; + POST, `[id]` PATCH, DELETE), summary, home, spend-limit (GET, PUT: daily and weekly limit), transactions (+ `[id]`, recurring list, series get and cancel, installment status), budgets and goals (+ `[id]` PATCH, DELETE): reads and writes over the shared services.
- credit-cards/summary and credit-cards/[accountId]/statements: read-only card dues and statements.
- bills (GET list, `[id]/pay` POST, `settings` GET PATCH): upcoming bills and reminder settings over bills.ts.
- loans (+ `[id]`, `[id]/repayments`): loan CRUD and repayments over loan-service.
- transfers (POST, `[id]` GET PATCH DELETE): money between own accounts over transfer-service. `transactions` GET also takes `includeIncomingTransfers`.
- captures, sms: bank message ingest (phone app, n8n). review/*: phone review inbox, confirm, correct, resolve, discard, history.
- subscriptions (GET detected repeating charges, `[id]` PATCH confirm or dismiss) over subscription-service.
- refunds (GET suggestions, `[id]/confirm` and `[id]/reject` POST): refund and reversal matching over refund-service.
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
