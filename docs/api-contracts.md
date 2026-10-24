# API Contracts

All endpoints return `{ data, message? }` on success and `{ error, details? }` on failure.

Pagination responses include `{ data[], total, skip, limit }`.

All monetary amounts are in **cents** (integers).

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/[...nextauth]` | — | NextAuth endpoints |
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/forgot-password` | — | Send reset email (always 200) |
| POST | `/api/auth/reset-password` | — | Consume reset token |

### POST /api/auth/register
```json
{ "name": "string", "email": "string", "password": "string", "confirmPassword": "string" }
```

## Me

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/me` | Get own profile |
| PATCH | `/api/me` | Update name/avatar/currency |
| PATCH | `/api/me/password` | Change password |
| GET | `/api/me/preferences` | Get preferences |
| PATCH | `/api/me/preferences` | Update preferences |

## Accounts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/accounts` | List non-archived accounts |
| POST | `/api/accounts` | Create account |
| GET | `/api/accounts/:id` | Get account |
| PATCH | `/api/accounts/:id` | Update name/color/icon |
| DELETE | `/api/accounts/:id` | Archive (soft delete) |

## Transactions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/transactions` | List with filters + pagination |
| POST | `/api/transactions` | Create + update account balance |
| GET | `/api/transactions/stats?month&year` | Monthly stats (Redis cached 5min) |
| GET | `/api/transactions/:id` | Get single |
| PATCH | `/api/transactions/:id` | Update metadata only |
| DELETE | `/api/transactions/:id` | Delete + reverse balance |

### GET /api/transactions query params
- `type` — `income | expense | transfer`
- `category` — category string
- `accountId` — filter by account
- `includeIncomingTransfers=true` (integrations only) — with `accountId`, also list transfers that moved money into that account
- `search` — full-text search
- `dateFrom` / `dateTo` — ISO date strings
- `skip` / `limit` — pagination

### POST /api/transactions body
```json
{
  "accountId": "string",
  "type": "income | expense | transfer",
  "amount": 1000,
  "currency": "USD",
  "category": "string",
  "description": "string",
  "date": "ISO string",
  "transferToId": "string (transfer only)"
}
```

### Transfers (integrations only)
A transfer is one `type: "transfer"` row (`account` is the source, `transferTo` the destination). It moves both balances and counts as neither income nor spending in stats, budgets and spend limits.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/integrations/transfers` | Body `{fromAccountId, toAccountId, amount, currency?, date?, note?, description?}`. 201 with `{id, type, amount, currency, fromAccountId, toAccountId, date, note, description, createdAt, updatedAt}`. 400 same account twice, bad amount; 404 an account is not yours or is archived |
| GET | `/api/integrations/transfers/:id` | Same shape. 404 for another user's row or a non-transfer id |
| PATCH | `/api/integrations/transfers/:id` | Any of `fromAccountId, toAccountId, amount, date, note, description` (at least one). Old movement reversed and new applied; 400 same account, nothing to update, locked by a statement payment; 404 unknown |
| DELETE | `/api/integrations/transfers/:id` | Soft delete, both balances put back. `{id, deleted: true}` |

`POST /api/integrations/transactions` answers with `transferToId` (null unless the row is a transfer).

## Cash

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/integrations/cash` | `{account, lowBalanceAt, lowBalanceIsDefault, isLow, last30Days: {withdrawn, withdrawals, spent}, recentWithdrawals: [{id, amount, date, fromAccountId, description}]}`. `account` is `{id, name, balance, currency, lowBalanceAt}` or null when the user has no live cash account (the other fields are then zero or default). `withdrawn` sums transfers into cash, `spent` sums expenses on it; amounts are paise; `lowBalanceAt` is the effective line (set value or 50000), `account.lowBalanceAt` is null when unset |
| POST | `/api/integrations/cash` | Body `{name?, openingBalance?, lowBalanceAt?}` (all optional; `lowBalanceAt` is paise >= 0 or null for the default; needs `Idempotency-Key`). Creates the cash account if none (201, named "Cash" unless `name`), otherwise updates `name` and `lowBalanceAt` (200). Same shape as GET. 400 bad data |

An ATM withdrawal message (`withdrawn ... at ATM`, `cash withdrawal`, `ATM WDL`) from a debit on a matched bank account becomes an unreviewed transfer (description "ATM withdrawal") into the user's cash account instead of an expense, once the message is read with enough confidence. With no live cash account it stays an ordinary expense. The accounts list also returns `lowBalanceAt` (cash accounts, when set).

## Spend limit

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/spend-limit` | Daily and weekly limits, today and week progress, safe to spend |
| PUT | `/api/spend-limit` | Change limits. Send only what changes; `null` clears a limit or resumes a pause |

A change to the daily or weekly amount applies from the start of the current day in the user's time zone; earlier days keep the limit they had. Every read (here, `/api/integrations/spend-limit`, and `spendLimit` in home and summary) carries `history`: `[{from, dailyAmount, weeklyAmount}]`, oldest first, newest last (equals the current amounts), `from` the ISO instant of a local midnight, amounts in paise or `null` for no limit. Empty for limits set before history existed (the current amounts then apply to every earlier day). To judge a past day use the last entry whose `from` is at or before that day's start (`limitOn` in `src/lib/spend-limit.ts`).

## Card rewards

Reward rule per credit card (`cashback` percent of spend or `points` per 100 rupees, category rates, optional cap per billing cycle) and the estimate it earns. Same data as `/api/integrations/credit-cards/**/rewards` (see [n8n-integration.md](n8n-integration.md#card-rewards)), session auth, bare JSON.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/credit-cards/rewards` | `{cards, currentValue}`: every active card with its rule and current-cycle estimate |
| GET | `/api/credit-cards/:accountId/rewards?cycles=3` | `{accountId, name, lastFourDigits, rule, reason, cycles, total}`; 404 unknown or archived card, 400 not a credit card or bad `cycles` |
| PUT | `/api/credit-cards/:accountId/rewards` | Replaces the rule: `{kind, baseRate, categoryRates?, cap?, pointValue?}`; 400 if invalid |
| DELETE | `/api/credit-cards/:accountId/rewards` | Removes the rule |

## Subscriptions

Repeating charges found in expense history (same merchant, similar amount, steady gap; weekly, monthly, quarterly or yearly). Detected on every read; only the confirm and dismiss choices are stored. Recurring series the user already tracks are left out.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/subscriptions?status&includeLapsed` | `{subscriptions, totals: {count, monthly, yearly}}`. `status` is `detected`, `confirmed`, `dismissed` or `all`; the default hides dismissed. `includeLapsed=true` adds ones whose next charge is long overdue |
| PATCH | `/api/subscriptions/:id` | `{status: "confirmed" | "dismissed" | "detected"}`; 404 if the id is not a current detection |

## Cash flow forecast

The expected balance of the money in hand (bank, cash, wallet and savings accounts) for the next days, and the lowest point. Read-only, computed on every read.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/forecast?days` | Same forecast as the integration route, returned as `{data}`. `days` is 1 to 60 (default 30); anything else is 400 |

Credit cards are paid when their statement is due; money others owe the user is not counted. See `docs/n8n-integration.md` for the response.

## Sinking funds and savings rate

Money set aside for a cost with a due date, and the share of income saved. Amounts are paise. Progress fields are computed on every read: `remaining`, `percent`, `monthsLeft`, `suggestedMonthly`, `status` (`done`, `overdue`, `on_track`, `behind`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sinking-funds` | `{funds, totals: {count, targetAmount, savedAmount, remaining, monthlyNeeded}}`, soonest due first |
| POST | `/api/sinking-funds` | `{name, targetAmount, dueDate, savedAmount?, monthlyAmount?, icon?}`; 201 with the fund |
| GET, PATCH, DELETE | `/api/sinking-funds/:id` | Read, edit (`name`, `targetAmount`, `dueDate`, `monthlyAmount` or `null`, `icon`), soft delete; 404 if not yours |
| POST | `/api/sinking-funds/:id/contribute` | `{amount}` (integer, not 0, at most 1e14 either way): positive saves, negative takes out, never below 0; a deposit that would take the balance past 1e14 is refused with 400 (not capped); returns the fund |
| GET | `/api/savings-rate?months=6` | `{months: [{year, month, income, expense, saved, rate}], current, average: {income, expense, saved, rate}, trend}`; `months` 1 to 24; `rate` is a fraction or `null` without income; `trend` is `up`, `down`, `flat` or `null` |

n8n and the app use `/api/integrations/sinking-funds` (+ `/:id`, `/:id/contribute`) and `/api/integrations/savings-rate` with the integration envelope; writes need `Idempotency-Key`.

## Net worth

What the user owns minus what they owe. Owned: positive account balances, a card with a credit balance, money lent not yet paid back, manual assets. Owed: a card balance below zero, any other account below zero, money borrowed not yet paid back. Archived or deleted accounts, settled or deleted loans and archived manual assets count for nothing. Amounts are cents.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/net-worth?range=30d\|90d\|1y\|all` | `{assets, liabilities, netWorth, breakdown: {assets: [{key,label,amount,count}], liabilities: [...]}, range, history: [{date,assets,liabilities,netWorth}], change: {amount, percent, since}}`. `range` defaults to `90d`; an unknown value falls back to it. `history` is oldest first and ends with today; `change` compares now with the first point (`since` is null when there is only today, `percent` is null when that point was 0). Reading it stores today's point |
| GET, POST | `/api/net-worth/assets` | List and add manual assets: `{name (1 to 60), kind?: property\|vehicle\|gold\|investment\|other, value (cents, int, 0 or more), note? (200)}` |
| PATCH, DELETE | `/api/net-worth/assets/:id` | Edit any of name, kind, value, note (`null` clears it); DELETE archives the asset. 404 for an unknown or other user's id |

## Weekly review

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/weekly-review?week=YYYY-MM-DD` | Look back at one week, Monday to Sunday in the user's time zone; default the last completed week. Same body as `/api/integrations/weekly-review` (see [n8n-integration.md](n8n-integration.md#weekly-review)), wrapped as `{data}`. 400 for a bad date or a week that has not started |

Integration only: `GET` and `PATCH /api/integrations/weekly-review/settings` (`{enabled, day}`, notification off by default), and the cron hook `GET /api/cron/weekly-review`.

## Budgets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/budgets?month&year` | List with spent amounts |
| POST | `/api/budgets` | Create |
| GET | `/api/budgets/:id` | Get single |
| PATCH | `/api/budgets/:id` | Update limitAmount/alertAt/isActive |
| DELETE | `/api/budgets/:id` | Delete |

## Categorise rules

Same merchant, same category and clean name. Rules run in `priority` order (lower first, then oldest); the first match wins. They fill in only what the person left at the default (category still `other`, a merchant name that came from a bank message) and add tags; they never overwrite a value the person set.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rules` | List, in the order they run |
| POST | `/api/rules` | Create `{field, op?, value, category?, merchantName?, accountId?, tags?, priority?, isActive?}` (at least one action) |
| PATCH | `/api/rules/:id` | Edit; `null` clears category, merchantName or accountId |
| DELETE | `/api/rules/:id` | Delete (hard) |

Errors: 400 invalid, 404 not found or someone else's account, 409 same match already exists or 200 rules reached. Integration twins with the `{success, data}` envelope: [n8n-integration.md](n8n-integration.md).

## Loans

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loans` | List (filter: direction, isSettled) |
| POST | `/api/loans` | Create |
| GET | `/api/loans/:id` | Get single |
| PATCH | `/api/loans/:id` | Update |
| DELETE | `/api/loans/:id` | Delete |
| GET | `/api/loans/:id/repayments` | List repayments |
| POST | `/api/loans/:id/repayments` | Add repayment (updates remainingAmount) |

## Reconcile

Auto-captured payments (SMS, n8n, bank-app notifications) and their review / correction flow. Full rules and every route: [docs/reconcile.md](reconcile.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reconcile` | Inbox: unreviewed captured transactions, queued messages, counts |
| GET | `/api/reconcile/history` | Every correction, newest first |
| GET | `/api/transactions/:id/corrections` | Where this transaction's values came from + its corrections |
| POST | `/api/transactions/:id/confirm` | Mark an auto-captured transaction as correct |
| POST | `/api/transactions/:id/corrections` | Fix it in place `{changes, reason, note?}`; `duplicate` / `not_a_transaction` voids it |
| POST | `/api/captures/:id/resolve` | Act on a queued message `{action: create\|link\|keep_mine\|use_sms}` |
| DELETE | `/api/captures/:id` | Discard a queued message (kept on record) |

### Refunds (phone only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/integrations/refunds` | Suggested refund matches, each with the expense it probably refunds |
| POST | `/api/integrations/refunds/:id/confirm` | Link the credit to its expense `{originalId?}`; needs `Idempotency-Key` |
| POST | `/api/integrations/refunds/:id/reject` | Drop a suggestion or unlink a confirmed refund; needs `Idempotency-Key` |

Shapes and errors: [docs/n8n-integration.md](n8n-integration.md#refunds-and-reversals).

## Goals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/goals` | List |
| POST | `/api/goals` | Create |
| GET | `/api/goals/:id` | Get single |
| PATCH | `/api/goals/:id` | Update (fires goal_reached notification if complete) |
| DELETE | `/api/goals/:id` | Delete |

## Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | List (filter: unread=true) |
| PATCH | `/api/notifications/:id` | Mark read/unread |
| DELETE | `/api/notifications/:id` | Delete |
| POST | `/api/notifications/read-all` | Mark all read |

## Logs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/logs/otp/status` | Get logs authenticator/unlock status |
| POST | `/api/logs/otp/setup` | Start first-time authenticator setup and return QR payload |
| POST | `/api/logs/otp/verify` | Confirm setup, unlock logs, or use a recovery code |
| POST | `/api/logs/otp/rotate/start` | Start authenticator rotation with current password + current TOTP |
| POST | `/api/logs/otp/rotate/confirm` | Confirm authenticator rotation with the new TOTP code |
| POST | `/api/logs/otp/recovery/regenerate` | Regenerate recovery codes with current password + current TOTP |
| POST | `/api/logs/otp/disable` | Disable logs authenticator with current password + current TOTP |
| POST | `/api/logs/otp/lock` | Lock the current logs unlock session |
| GET | `/api/logs/ledger` | List append-only ledger blocks after TOTP unlock |
| GET | `/api/logs/ledger/verify` | Verify the hash-linked ledger chain after TOTP unlock |

`/api/logs/ledger` accepts `scope`, `entityId`, `skip`, and `limit` query params. `limit` is capped at 100.
Ledger/status requests include `x-logs-device-id`, a tab-scoped random id stored in `sessionStorage`.

## Push

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/push/subscribe` | Store subscription |
| DELETE | `/api/push/unsubscribe` | Deactivate subscription |

## Integrations realtime

Authenticated with an integration API key (`Authorization: Bearer <key>`), like every `/api/integrations/*` route. Full design: [docs/realtime.md](realtime.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/integrations/events` | SSE stream: `ready {now}`, `data-changed {resource}`, `ping {}` every 20s |
| GET | `/api/integrations/changes?since=<epoch ms>` | Polling fallback: which resources changed since |

`GET /api/integrations/changes` responds `200 {"success":true,"data":{"now":<epoch ms>,"changed":["transactions","goals"]},"requestId":"..."}` with `Cache-Control: no-store`. `now` is sampled before the query; store it and pass it as the next `since`. Missing or invalid `since` returns `changed: []`. Errors use the standard integration envelope (`401 UNAUTHORIZED`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`).

`resource` is one of `transactions`, `accounts`, `budgets`, `goals`, `loans`, `notifications`, `captures`.

## Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users (admin only) |
| GET | `/api/users/:id` | Get user (admin only) |
| PATCH | `/api/users/:id` | Update role/isActive (admin only) |
