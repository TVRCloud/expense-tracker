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

## Spend limit

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/spend-limit` | Daily and weekly limits, today and week progress, safe to spend |
| PUT | `/api/spend-limit` | Change limits. Send only what changes; `null` clears a limit or resumes a pause |

## Subscriptions

Repeating charges found in expense history (same merchant, similar amount, steady gap; weekly, monthly, quarterly or yearly). Detected on every read; only the confirm and dismiss choices are stored. Recurring series the user already tracks are left out.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/subscriptions?status&includeLapsed` | `{subscriptions, totals: {count, monthly, yearly}}`. `status` is `detected`, `confirmed`, `dismissed` or `all`; the default hides dismissed. `includeLapsed=true` adds ones whose next charge is long overdue |
| PATCH | `/api/subscriptions/:id` | `{status: "confirmed" | "dismissed" | "detected"}`; 404 if the id is not a current detection |

## Budgets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/budgets?month&year` | List with spent amounts |
| POST | `/api/budgets` | Create |
| GET | `/api/budgets/:id` | Get single |
| PATCH | `/api/budgets/:id` | Update limitAmount/alertAt/isActive |
| DELETE | `/api/budgets/:id` | Delete |

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
