# src/lib
Purpose: server business logic shared by browser routes, integration routes, server.ts timers and pages; plus a few client helpers. Overview: [docs/architecture.md](../../docs/architecture.md).

## Files
- Core: mongodb.ts (cached connection), redis.ts (optional), config.ts (env getters), logger.ts (pino), crypto.ts (AES-256-GCM field encryption).
- Auth: auth-options.ts, auth-guard.ts (`requireAuth`), cron-auth.ts, security-rate-limit.ts, log-security.ts, log-auth-request.ts, device-label.ts, email.ts.
- Money services: account-service.ts, transaction-service.ts, transfer-service.ts (transfers between own accounts: create, edit, delete over transaction-service), cash-service.ts (the cash account: low-cash view, setup on demand; `findCashAccount` is in account-service.ts), transaction-query.ts, transaction-activity.ts, stats-service.ts (month, range and daily totals), notification-service.ts, budget-service.ts, budget-alert.ts, spend-limit.ts (daily and weekly limit status, alerts and the end-of-day summary; a change to the amounts applies from today and is kept in `limitHistory`, `limitOn(history, current, date)` gives the limit a past day had; its zod schema lives in features/budgets/schemas/spend-limit.schema.ts), spend-limit-time.ts (day and week bounds in the user's time zone; `localDate` and `localDateKey` give the wall-clock date), goal-service.ts, loan-service.ts, credit-card-service.ts (summary and statements read paths), credit-card.ts, credit-balance.ts, card-rewards.ts (pure: reward rule schema, per-transaction rounding down, cap, refund take-back) and card-rewards-service.ts (rule get, set, clear and the per billing cycle estimate; shared by browser and integration routes), rule-service.ts (categorise rules: CRUD, first-match evaluation, the overrides applied on a new transaction), ledger.ts.
- Tax: tax-year.ts (pure: financial year April to March named by its start year, bounds at the user's midnight), tax-settings.ts (`preferences.tax.deductibleCategories`) and tax-service.ts (`getTaxSummary` one grouped aggregation, `foldTaxGroups` pure, CSV rows, `setTransactionDeductible`); shared by browser and integration routes.
- Net worth: net-worth.ts (assets minus liabilities from accounts, cards, loans and manual assets; a stored point per user per local day for the trend; manual asset CRUD; `recordSnapshotsForAllUsers` for the cron).
- Subscriptions: subscription-detector.ts (pure: finds repeating merchant charges, cadence, next date, yearly cost) and subscription-service.ts (reads 24 months of expenses, merges the user's confirm and dismiss decisions; shared by browser and integration routes).
- Forecast: forecast-math.ts (pure: daily balance points, lowest point, shortfall, subscription repeats) and cash-flow-forecast.ts (gathers liquid balances, unpaid recurring items, card and loan dues from bills.ts, subscriptions and the 30 day average spend).
- Bills: bills.ts (upcoming bills from recurring payments, card statements and loans owed; mark paid), bill-settings.ts (`preferences.billReminders`), bill-reminders.ts (once per bill per due date, from 09:00 local; `sendBillReminders`).
- Sinking funds and savings rate: sinking-fund-service.ts (funds with a due date and monthly set-aside; `describeFund` computes remaining, percent, monthsLeft, suggestedMonthly and status on read; atomic contribute) and savings-rate.ts (income minus spending per month from `getRangeStats`, average and trend). integrations/write-helpers.ts holds the Idempotency-Key, JSON body and conflict-message checks new integration routes share.
- Weekly review: weekly-review.ts (`summarizeWeek` and `buildHighlights` are pure; `getWeeklyReview` reads one Monday to Sunday week in the user's time zone; `sendWeeklyReviews` is the opt-in notification) and weekly-review-settings.ts (`preferences.weeklyReview`).
- Recurring and reminders: recurrence.ts, recurring-topup.ts, recurring-series.ts (series list, get, cancel; shared by browser and integration routes), reminder-scheduler.ts, emi-notifications.ts, credit-notifications.ts, push.ts.
- refund-service.ts (match a credit to the expense it refunds, suggest, confirm, reject; stats and budgets net confirmed refunds out), see [docs/reconcile.md](../../docs/reconcile.md).
- capture/ (ingest, parsers, source priority, account matching), reconcile/ (correct, inbox, http): [docs/reconcile.md](../../docs/reconcile.md).
- capture/ingest.ts: an ATM withdrawal parse (`atm: true` from `parseCapture`) with a live cash account is created as a transfer to cash, not an expense; `handleMatch` never rewrites that transfer from a later message.
- integrations/ (API-key auth, handler, idempotency, rate-limit, response, sms-parser), app-update.ts: [docs/n8n-integration.md](../../docs/n8n-integration.md).
- realtime/ (changes, sse, invalidation, changed-since): resources: transactions, accounts, budgets, goals, loans, notifications, captures, repayments, statements, spendLimits, subscriptions, sinkingFunds; a new one goes in `RESOURCES`, `MODELS` and `INVALIDATION_MAP`, see [docs/realtime.md](../../docs/realtime.md).
- realtime/ (changes, sse, invalidation, changed-since): resources: transactions, accounts, budgets, goals, loans, notifications, captures, repayments, statements, spendLimits, subscriptions, sinkingFunds, netWorth; a new one goes in `RESOURCES`, `MODELS` and `INVALIDATION_MAP`, see [docs/realtime.md](../../docs/realtime.md).
- perf/: ttl-cache, session-cache, background (`runInBackground`).
- Client or UI helpers: api-client.ts, query-client.ts, utils.ts (cents formatting), icons.tsx, category-colors.ts, route-titles.ts, csv.ts, regex.ts.

## Talks to
- Models in src/models. Callers: src/app/api, src/app pages, server.ts, scripts/.

## Rules and gotchas
- budget-service and goal-service own create, update and soft delete; the browser `[id]` routes and the integration `[id]` routes both call them.
- transfer-service owns transfer edit (amount, accounts, date: balances fixed in one pass); create and delete call transaction-service. A transfer row is never income or spending.
- subscription-service never stores detections, only the user's choice per merchant and cadence (`SubscriptionDecision`); it leaves out recurring series the user already tracks (`isRecurring`).
- tax-service counts income and spending only: no transfers, voided or deleted rows, recurring instalments once paid; a confirmed refund comes off spending. csv.ts leaves a real number alone, so a negative amount stays numeric, while text starting with a formula character is quoted.
- A confirmed refund (`refundStatus: confirmed` income row) is netted out in stats-service, budget-service and budget-alert; a new aggregation over income or expense must do the same.
- rule-service owns categorise rules; createTransaction() and capture/ingest.ts call it, the browser and integration rule routes call it. Rules are not a realtime resource.
- loan-service owns loan create, update, delete and repayments; the browser and integration loan routes both call it.
- Put logic here, not in routes. transaction-service, loan-service, goal-service, budget-service and stats-service exist so web and integration routes cannot drift.
- No mongoose sessions anywhere; multi-step writes are sequential.
- `appendLedgerBlock` (ledger.ts) writes a per-user hash chain (`sequence`, `previousHash`, `hash`); concurrent appends retry up to 25 times on the unique {user, sequence} index.
- Redis and the TTL caches are optional or per instance; code must work without them.
- capture/ingest.ts reads `CAPTURE_ENCRYPTION_KEY`; log-security.ts reads `TOTP_ENCRYPTION_KEY`.
- integrations/sms-parser.ts (`parseBankSms`) has no importer in src, scripts or server.ts; ingest uses `parseCapture` from capture/parsers.

## Tests
- `src/test/integrations.test.ts`, `src/lib/realtime/*.test.ts`, `src/lib/subscription-detector.test.ts`, `src/lib/forecast-math.test.ts`, `src/lib/card-rewards.test.ts`, `src/lib/weekly-review.test.ts`, `src/lib/tax-year.test.ts`.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
