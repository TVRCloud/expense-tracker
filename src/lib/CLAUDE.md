# src/lib
Purpose: server business logic shared by browser routes, integration routes, server.ts timers and pages; plus a few client helpers. Overview: [docs/architecture.md](../../docs/architecture.md).

## Files
- Core: mongodb.ts (cached connection), redis.ts (optional), config.ts (env getters), logger.ts (pino), crypto.ts (AES-256-GCM field encryption).
- Auth: auth-options.ts, auth-guard.ts (`requireAuth`), cron-auth.ts, security-rate-limit.ts, log-security.ts, log-auth-request.ts, device-label.ts, email.ts.
- Money services: account-service.ts, transaction-service.ts, transaction-query.ts, transaction-activity.ts, stats-service.ts (month, range and daily totals), notification-service.ts, budget-service.ts, budget-alert.ts, spend-limit.ts (daily and weekly limit status, alerts and the end-of-day summary; its zod schema lives in features/budgets/schemas/spend-limit.schema.ts), spend-limit-time.ts (day and week bounds in the user's time zone), goal-service.ts, loan-service.ts, credit-card-service.ts (summary and statements read paths), credit-card.ts, credit-balance.ts, ledger.ts.
- Recurring and reminders: recurrence.ts, recurring-topup.ts, recurring-series.ts (series list, get, cancel; shared by browser and integration routes), reminder-scheduler.ts, emi-notifications.ts, credit-notifications.ts, push.ts.
- capture/ (ingest, parsers, source priority, account matching), reconcile/ (correct, inbox, http): [docs/reconcile.md](../../docs/reconcile.md).
- integrations/ (API-key auth, handler, idempotency, rate-limit, response, sms-parser), app-update.ts: [docs/n8n-integration.md](../../docs/n8n-integration.md).
- realtime/ (changes, sse, invalidation, changed-since): resources: transactions, accounts, budgets, goals, loans, notifications, captures, repayments, statements, spendLimits; a new one goes in `RESOURCES`, `MODELS` and `INVALIDATION_MAP`, see [docs/realtime.md](../../docs/realtime.md).
- perf/: ttl-cache, session-cache, background (`runInBackground`).
- Client or UI helpers: api-client.ts, query-client.ts, utils.ts (cents formatting), icons.tsx, category-colors.ts, route-titles.ts, csv.ts, regex.ts.

## Talks to
- Models in src/models. Callers: src/app/api, src/app pages, server.ts, scripts/.

## Rules and gotchas
- budget-service and goal-service own create, update and soft delete; the browser `[id]` routes and the integration `[id]` routes both call them.
- loan-service owns loan create, update, delete and repayments; the browser and integration loan routes both call it.
- Put logic here, not in routes. transaction-service, loan-service, goal-service, budget-service and stats-service exist so web and integration routes cannot drift.
- No mongoose sessions anywhere; multi-step writes are sequential.
- `appendLedgerBlock` (ledger.ts) writes a per-user hash chain (`sequence`, `previousHash`, `hash`); concurrent appends retry up to 25 times on the unique {user, sequence} index.
- Redis and the TTL caches are optional or per instance; code must work without them.
- capture/ingest.ts reads `CAPTURE_ENCRYPTION_KEY`; log-security.ts reads `TOTP_ENCRYPTION_KEY`.
- integrations/sms-parser.ts (`parseBankSms`) has no importer in src, scripts or server.ts; ingest uses `parseCapture` from capture/parsers.

## Tests
- `src/test/integrations.test.ts`, `src/lib/realtime/*.test.ts`.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
