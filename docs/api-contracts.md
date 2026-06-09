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

## Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users (admin only) |
| GET | `/api/users/:id` | Get user (admin only) |
| PATCH | `/api/users/:id` | Update role/isActive (admin only) |
