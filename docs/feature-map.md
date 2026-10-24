# Feature map

One row per feature or module: what it is for and where its files are, so you can find code from this page instead of grepping. Each `src/features/<name>/` and the main `src/app/api/<area>/` dirs also have a `CLAUDE.md` with file-level detail. Update the row and that `CLAUDE.md` in the same change as the code ([contributing](contributing.md#documentation)).

Mobile app = the separate repo `expense-tracker-mobile` (Flutter UI in `lib/features/*`, Kotlin capture in `android/`). It only calls `/api/integrations/*`, through `lib/core/api/review_api.dart`. Page-by-page UI specs are in [docs/pages/](pages/).

## Features

| Feature | Purpose | UI pages (`src/app/`) | Feature dir | API (`src/app/api/`) | Models | Lib | Mobile app |
|---|---|---|---|---|---|---|---|
| Dashboard | Home: net worth, month totals, accounts, recent rows | `(app)/dashboard` | `features/dashboard` | `transactions/stats` GET, `transactions` GET, `accounts` GET | Transaction, Account, User | stats-service, transaction-query | Home (`features/home`) via `integrations/home` |
| Transactions | List, filter, add, edit, delete income/expense/transfer; split and recurring entry | `(app)/transactions`, `/add`, `/[id]` | `features/transactions` | `transactions` GET POST, `transactions/[id]` GET PATCH DELETE, `transactions/stats` GET, `transactions/stats/range` GET; n8n: `integrations/transfers` POST, `integrations/transfers/[id]` GET PATCH DELETE | Transaction, Account | transaction-service, transfer-service, transaction-query, transaction-activity, stats-service, ledger, csv | Activity (`features/activity`) via `integrations/transactions` |
| Recurring | Recurring series and upcoming installments | `(app)/transactions/recurring`, `/recurring/[recurringId]` | `features/recurring` | `transactions/recurring` GET, `.../[recurringId]` GET DELETE, `.../installments/[id]` PATCH, `cron/recurring-topup` GET | Transaction | recurrence, recurring-topup | none (API: `integrations/transactions/recurring` GET, `.../[recurringId]` GET DELETE, `.../installments/[id]` PATCH) |
| Accounts | Create, edit, archive accounts; SMS match digits; the cash account and its low-cash view | `(app)/accounts`, `/accounts/[id]` | `features/accounts` | `accounts` GET POST, `accounts/[id]` GET PATCH DELETE, `accounts/[id]/recalculate` POST; n8n: `integrations/cash` GET POST, `integrations/accounts` GET POST, `integrations/accounts/[id]` PATCH DELETE | Account, Transaction | account-service, cash-service, ledger | Home account cards via `integrations/accounts` |
| Credit cards | Limit, utilization, billing cycles, statements, pay now; embedded in Accounts, Transactions, Dashboard | none of its own | `features/credit-cards` | `credit-cards/summary` GET, `credit-cards/[accountId]/statements` GET, `.../[statementId]` PATCH; n8n: `integrations/credit-cards/summary` GET, `integrations/credit-cards/[accountId]/statements` GET | Account, CreditStatement, Transaction | credit-card-service, credit-card, credit-balance, credit-notifications | none |
| Budgets | Monthly category budgets and alerts | `(app)/budgets` | `features/budgets` | `budgets` GET POST, `budgets/[id]` GET PATCH DELETE; `spend-limit` GET PUT, `cron/spend-limit-summary` GET; n8n: `integrations/budgets` GET POST, `integrations/budgets/[id]` PATCH DELETE, `integrations/spend-limit` GET PUT | Budget, SpendLimit, Transaction | budget-service, budget-alert, spend-limit, spend-limit-time | none |
| Goals | Savings goals | `(app)/goals` | `features/goals` | `goals` GET POST, `goals/[id]` GET PATCH DELETE; n8n: `integrations/goals` GET POST, `integrations/goals/[id]` PATCH DELETE | Goal | goal-service | none |
| Categorise rules | Same merchant, same category and clean name; applied on capture and manual add | none yet (API only) | none | `rules` GET POST, `rules/[id]` PATCH DELETE | Rule, Account | rule-service | API: `integrations/rules`, `integrations/rules/[id]`, `integrations/rules/test`; applied in transaction-service and capture/ingest |
| Loans | Money lent or borrowed, repayments | `(app)/loans` | `features/loans` | `loans` GET POST, `loans/[id]` GET PATCH DELETE, `loans/[id]/repayments` GET POST | Loan, Repayment, Account, Transaction | loan-service | none (API: `integrations/loans`, `loans/[id]`, `loans/[id]/repayments`; EMI captures reuse loan-service) |
| Subscriptions | Repeating charges found in expense history, with next date and yearly cost; confirm or dismiss each | `(app)/subscriptions` | `features/subscriptions` | `subscriptions` GET, `subscriptions/[id]` PATCH; n8n: `integrations/subscriptions` GET, `integrations/subscriptions/[id]` PATCH | Transaction, SubscriptionDecision | subscription-detector, subscription-service | none yet (app ticket TVRCloud/expense-tracker-mobile#50 uses `integrations/subscriptions`) |
| Analytics | Charts, category breakdown, history | `(app)/analytics` | `features/analytics` | `transactions/stats` GET, `transactions/stats/range` GET; n8n: `integrations/stats` GET | Transaction | stats-service, category-colors | none |
| Bill reminders | Upcoming bills (recurring payments, card statements, loans owed), reminders before they are due, mark paid | none | none | `cron/bill-reminders` GET; n8n: `integrations/bills` GET, `integrations/bills/[id]/pay` POST, `integrations/bills/settings` GET PATCH | User (`preferences.billReminders`), Notification, Transaction, Loan, Account | bills, bill-settings, bill-reminders | Bills screen (ticket mobile#51) |
| Notifications | In-app inbox, deep links | `(app)/notifications` | `features/notifications` | `notifications` GET, `notifications/[id]` PATCH DELETE, `notifications/read-all` POST; n8n: `integrations/notifications` GET, `.../[id]` PATCH, `.../read-all` POST | Notification | notification-service, budget-alert, emi-notifications, credit-notifications | none found |
| Push | Web push subscribe, status, test | (inside Settings) | `features/settings` (hooks) | `push/status` GET, `push/subscribe` POST, `push/unsubscribe` DELETE, `push/test` POST | PushSubscription | push, reminder-scheduler | none |
| Reconcile | Review inbox for captured transactions and queued bank messages; confirm, correct, void; refund matching (a credit linked to the expense it refunds) | `(app)/reconcile` | `features/reconcile` | `reconcile` GET, `reconcile/history` GET, `transactions/[id]/confirm` POST, `transactions/[id]/corrections` GET POST, `captures/[id]/resolve` POST, `captures/[id]` DELETE | CapturedMessage, Transaction, TransactionCorrection | reconcile/*, capture/*, refund-service | Review (`features/review`) via `integrations/review/*`, `integrations/refunds/*` |
| Capture ingest | Bank SMS and notifications become transactions (ATM withdrawals become transfers to the cash account), with source priority and dedupe | none | none | `integrations/captures` POST, `integrations/sms` POST, `cron/promote-captures` GET | CapturedMessage, Transaction | capture/* (ingest, parsers, account-match, source), crypto | Kotlin capture in `android/.../capture` uploads to `integrations/captures` |
| Settings and Account | Profile, preferences, appearance, notifications, security, API keys, privacy | `(app)/settings` + 8 subpages, `(app)/account` | `features/settings` | `me` GET PATCH DELETE, `me/password` PATCH, `me/preferences` GET PATCH (incl. `timezone`), `me/export` GET, `me/api-keys` GET POST, `me/api-keys/[id]` DELETE | User, ApiKey, Session | integrations/api-keys, perf/session-cache | Connect (`features/connect`) uses a key minted here |
| Auth | Login, register, forgot and reset password | `(auth)/login`, `/register`, `/forgot-password`, `/reset-password/[token]` | `features/auth` | `auth/[...nextauth]`, `auth/register` POST, `auth/forgot-password` POST, `auth/reset-password` POST | User, Session | auth-options, auth-guard, email, security-rate-limit | none (API key instead) |
| Admin | Admin user list, role and status | `(app)/admin/users` | `features/admin` | `users` GET, `users/[id]` GET PATCH | User, Session | regex, perf/session-cache | none |
| Logs | TOTP-gated ledger viewer and chain verify | `(app)/logs` | `features/logs` | `logs/ledger` GET, `logs/ledger/verify` GET, `logs/otp/*` (status GET; setup, verify, lock, disable, rotate/start, rotate/confirm, recovery/regenerate POST) | LedgerBlock, LogSecurity, LogUnlockSession | ledger, log-security, log-auth-request | none |
| Landing | Public marketing page | `(public)/page.tsx` | `features/landing` | none | none | none | none |
| Offline | Page shown by the service worker when offline | `(app)/offline` | none | none | none | none | none |

## Integrations, realtime and app support (no feature dir)

| Module | Purpose | Where | Mobile app |
|---|---|---|---|
| n8n and app API | API-key surface with its own envelope, idempotency, rate limit | `api/integrations/*` (all routes), `lib/integrations/*` | `lib/core/api/review_api.dart` |
| Realtime | SSE and polling "resource changed" signals; client invalidation | `api/events` GET, `api/integrations/events` GET, `api/integrations/changes` GET, `lib/realtime/*`, `components/providers/{SocketProvider,RealtimeSync}.tsx`, `hooks/useSocket.ts` | `lib/core/realtime` |
| App update | Newest Android release and signed APK URL | `api/integrations/app-update` GET, `.../download` GET, `lib/app-update.ts` | `features/update` |
| Home and summary | One-request home data; month summary | `api/integrations/home` GET, `api/integrations/summary` GET | Home |
| Cron | Scheduler hooks | `api/cron/promote-captures`, `api/cron/recurring-topup`, `lib/cron-auth.ts`, `vercel.json` | none |

## Shared code

| Area | Purpose | Where |
|---|---|---|
| `src/lib` | Server business logic and helpers | [src/lib/CLAUDE.md](../src/lib/CLAUDE.md) |
| `src/models` | Mongoose schemas, 20 files: Account, ApiKey, Budget, CapturedMessage, CreditStatement, Goal, IdempotencyRecord, LedgerBackfill, LedgerBlock, Loan, LogSecurity, LogUnlockSession, Notification, PushSubscription, Repayment, SecurityRateLimit, Session, Transaction, TransactionCorrection, User | [src/models/CLAUDE.md](../src/models/CLAUDE.md) |
| `src/hooks` | `useCurrency` (currency formatting from the profile), `useSocket` (subscribe to SSE events via SocketProvider) | `src/hooks/` |
| `src/utils` | `password.ts`: `hashPassword`, `verifyPassword` | `src/utils/` |
| `src/components` | App shell (`layout/`: Sidebar, BottomNav, headers, CommandPalette), providers, shared pieces, shadcn `ui/`, `_ui/` | `src/components/` ([design-system.md](design-system.md)) |
| `src/types` | `models.ts`, `api.ts`, `next-auth.d.ts` | `src/types/` |
| `src/proxy.ts` | Redirects signed-out users to `/login`; exempts auth pages, `api/auth`, `api/cron`, `api/integrations`, static and PWA files | `src/proxy.ts` |
| `server.ts` | Custom HTTP server for `yarn dev` and `yarn start`: runs Next, plus timers: reminder checks and recurring top-up (30s after start, then every 6h), pending-SMS promotion every 5 min. No Socket.io. | `server.ts` |
| `worker/` | PWA service worker source (Serwist, push handlers). Not a job runner. | [worker/CLAUDE.md](../worker/CLAUDE.md) |
| `scripts/` | `api-keys.ts` (create, list, revoke API keys; `yarn api-keys`), `migrate-captures.ts` (one-off move of `sms_review_items` into the capture inbox; `yarn migrate:captures`) | `scripts/` |
| `scripts/check-feature-docs.sh` | Fails when a dir with a `CLAUDE.md` changed without it | `scripts/` |

## Tests

Only three test files exist, run with `yarn test` (Vitest):
- `src/test/integrations.test.ts`: transaction service, API-key auth, `/api/me/api-keys`, idempotency, integration transactions, capture parser, ingest and reconcile, home read paths, account matching, app update, changes.
- `src/lib/realtime/changes.test.ts`, `src/lib/realtime/invalidation.test.ts`.

## Known doc drift

Things the code does that older docs say otherwise (verified against code):
- [architecture.md](architecture.md) calls `server.ts` legacy; it is the entry point for `yarn dev` and `yarn start` and runs the timers above.
- [pwa.md](pwa.md) says next-pwa; `next.config.ts` and `worker/index.ts` use Serwist.
- [authentication.md](authentication.md) names `UserSession` and an admin layout redirect; the model file is `Session.ts` (collection `userSession`) and no `(app)/admin/layout.tsx` exists.
- README and architecture say Next.js 15; `package.json` has `next` 16.3.4.
