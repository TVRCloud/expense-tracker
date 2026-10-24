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

## Export and import (integrations only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/integrations/export/transactions?accountId&dateFrom&dateTo` | A CSV file (`text/csv`, not the JSON envelope). Columns `date,type,amount,currency,category,subcategory,description,account,transferTo,note,tags,source`; `amount` in major units (`1250.50`), `tags` joined by `;`, `date` is `YYYY-MM-DD` on the user's clock. Voided, deleted and not-yet-happened planned instalments are left out. At most 20,000 rows: `X-Export-Truncated: true` says there are more (ask again with a narrower range); `X-Export-Rows` is the count. Cells starting `= + - @` get a leading `'`. 400 for a bad date or account |
| POST | `/api/integrations/import/preview` | Dry run, nothing written. Body `{accountId, csv, mapping?, dateOrder?, amountSign?}`. `mapping` names columns by header text: `{date, amount \| debit+credit, type?, description?, category?, note?, tags?}`; without it the header is guessed (the guess is in the answer). `dateOrder` `dmy` (default), `mdy`, `ymd` for numeric dates; `amountSign` `signed` (default: negative is an expense), `expense`, `income` for files with unsigned amounts. 200 `{account, delimiter, headers, mapping, totalRows, validCount, duplicateCount, invalidCount, importCount, incomeTotal, expenseTotal, errors[{row,field,message}] (first 50), sample[{row,date,type,amount,description,category,tags,duplicate}] (first 20)}`. 400 `VALIDATION_ERROR` with `details.code` `NEEDS_MAPPING` (a mapped column is not in the file, or no date or amount column; `missingColumns` or `headers` say which) or `INVALID_CSV` (empty, over 1,000 rows, over 50 columns, over 1 MB); 404 account not yours or archived |
| POST | `/api/integrations/import/commit` | Same body plus `includeDuplicates` (default false) and `adjustBalance` (default false: the rows are history the balance already shows). Needs `Idempotency-Key`. 201 `{account, totalRows, imported, skippedDuplicates, invalidCount, failed, errors}`. Rows get `source: import`, no review inbox entry, no budget or spend limit alert, no round-up; categorise rules still apply. Invalid rows are skipped and reported |

A row is a duplicate when the account already has a live row on the same calendar day (user's clock) with the same type and amount; equal rows inside one file only match as many as already exist, so re-importing a file adds nothing. Income and expense only: transfers are not imported.

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

## Tax

The financial year runs 1 April to 31 March in the user's time zone and is named by the year it starts in: `fy=2025` is 2025-26. Only income and spending count: transfers between own accounts, voided rows, deleted rows and recurring instalments not yet paid are left out (an ATM withdrawal is a transfer only when the user has a cash account; otherwise it is an expense and counts). A confirmed refund comes off spending in the year it arrived (by the refund's own date, so a refund in a later year than its purchase lowers that later year, and can make it negative), and is skipped when the expense it refunds is voided or deleted. An expense is deductible when its own `deductible` flag is `true`, or the flag is unset and its category is in the user's list; `false` wins over the list. A refund is deductible exactly when the expense it refunds is (that expense's flag, else its category; a refund links to one line of a split purchase, so that line decides, not the whole group); an unlinked refund follows its own category. Category names are compared trimmed and lower case. Amounts are cents.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tax?fy=2025` | `{fy, label, start, end, timeZone, income, expense, saved, count, deductible: {total, byCategory: [{category,total}]}, incomeByCategory, expenseByCategory, byMonth: [{month: "YYYY-MM", income, expense, deductible}] (12, April first), deductibleCategories, availableYears}`. `fy` is a four digit year, 2000 to 2100, default the current year; anything else is 400. `availableYears` runs from the year of the first row to the year of the last, gaps included (at most 100). It never misses a year but may list one with no counted row (a paid instalment whose scheduled date is far from its paid date can stretch the range). `expense` is net of refunds; `saved` is `income - expense` and can be negative; `count` is the income, expense and refund rows counted; `start` and `end` are ISO instants, end excluded |
| GET | `/api/tax/export?fy=2025` | The same figures as `text/csv` (`section,name,amount`, amounts in rupees), file name `tax-summary-2025-26.csv`. A name that starts with `=`, `+`, `-`, `@`, tab or CR is quoted with a leading `'` |
| GET, PUT | `/api/tax/settings` | `{deductibleCategories: string[]}`. PUT replaces the list (up to 50 names of 1 to 40 characters; stored trimmed and lower case, matched without regard to case) |
| PATCH | `/api/tax/settings` | `{add?: string[], remove?: string[]}` (at least one): change the list by what moved, atomically; remove wins over add for the same name. Answers the list. 400 when it would pass 50 names. Use it from a UI so two changes cannot overwrite each other |
| PATCH | `/api/tax/transactions/:id` | `{deductible: true \| false \| null}` for one expense: `true` or `false` overrides the list, `null` goes back to it. Answers `{id, deductible}`. 404 for another user's row, a deleted row or a row that is not an expense |

n8n and the app use `/api/integrations/tax`, `/api/integrations/tax/export` (CSV, not the envelope), `/api/integrations/tax/settings` (GET, PUT, PATCH) and `/api/integrations/tax/transactions/:id` with the integration envelope; PUT and PATCH need `Idempotency-Key`. There is no PDF: the web page `/tax` has a Print button (save as PDF from the print dialog).

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

## Backup and restore

Integration routes only, with the integration envelope. Design and threat model: [backup.md](backup.md). Both are `POST` because the passphrase must be in the body. The passphrase is 12 to 256 characters.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/integrations/backup` | Body `{passphrase}`. 200 `{backup, createdAt, counts, omitted}`. `backup` is the encrypted file as JSON (save it as is: `{format, v: 2, createdAt, kdf, cipher, ciphertext}`; version 1 files from earlier still restore); `counts` is rows per kind (`accounts`, `transactions`, `budgets`, `goals`, `loans`, `repayments`, `rules`, `sinkingFunds`, `manualAssets`, `subscriptionDecisions`, `spendLimit`); `omitted` lists kinds with rows that could not go in (for example transactions of a deleted account), empty when nothing was left out. No `Idempotency-Key`. 400 short passphrase or too much data (`error.reason: too_large`); 413 `TOO_LARGE_FOR_RESPONSE` when the file would pass about 4 MB (a platform response limit; suggest a CSV export instead); 429 more than 6 exports in 10 minutes |
| POST | `/api/integrations/backup/restore` | Body `{passphrase, backup, dryRun?, mode?}`; `backup` is the file from the route above, `mode` can only be `"merge"`. `dryRun: true` checks the file and writes nothing (no `Idempotency-Key`); a real restore needs `Idempotency-Key`. 200 `{dryRun, restored, backupCreatedAt, counts, warnings}` where `counts[kind]` is `{inBackup, toCreate, existing}` (`existing` rows are kept and skipped) and `warnings` is a list of plain sentences to show. 400 with `error.reason`: `unreadable` (wrong passphrase or changed file, one message for both), `invalid` (not a backup this server reads, or the contents fail the checks, or made by a newer version), `too_large`; 409 the key was used with a different file or is in progress; 429 more than 12 real restores or 30 dry runs in 10 minutes (separate counts), or `reason: busy` when the server is opening other backups (retry shortly). Warnings include rows skipped because they sit in the user's trash. The same file and key replays the first answer, but only with the right passphrase. Rows are only ever added: nothing is deleted or overwritten |

An older server answers 404 for both routes.

## Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users (admin only) |
| GET | `/api/users/:id` | Get user (admin only) |
| PATCH | `/api/users/:id` | Update role/isActive (admin only) |
