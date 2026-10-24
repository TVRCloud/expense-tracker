# n8n Integration

A dedicated API surface under `/api/integrations/*` lets an external n8n instance
read and record data in this app without ever touching MongoDB directly. Every
integration route calls the same business logic the browser app uses (account
balance updates, ledger entries, budget alerts, recurring handling) — n8n
cannot bypass or duplicate that logic.

## Configuration

Global rate-limit tuning, set in your environment:

```
N8N_RATE_LIMIT=30            # requests per window per route (default 30)
N8N_RATE_WINDOW_MS=60000     # window length in ms (default 60000)
N8N_IDEMPOTENCY_TTL_SECONDS=86400  # how long idempotency records live (default 24h)
```

In-app updates for the Android companion app (see "App updates" below):

```
APP_RELEASES_REPO=TVRCloud/expense-tracker-mobile   # the private repo with the app's releases
APP_RELEASES_TOKEN=                                  # fine-grained GitHub token, read-only Contents on that repo
```

The API key itself is **not** an env var — it lives in the `api_keys` collection
(`src/models/ApiKey.ts`), one row per caller (n8n, the mobile companion app, etc),
so each can be revoked independently. Mint one with:

```
yarn api-keys create --label n8n --email <the app's user account email>
```

This prints the raw key once — store it in n8n's credential now, it can't be
retrieved again later. `yarn api-keys list` shows existing keys (masked);
`yarn api-keys revoke --id <apiKeyId>` disables one immediately.

If you previously configured `N8N_API_KEY`/`N8N_USER_EMAIL`, those env vars are
no longer read — mint a replacement key with the command above and update your
n8n credential.

## Authentication

Every request must include:

```
Authorization: Bearer <YOUR_API_KEY>
```

- Missing or malformed header → `401`.
- Wrong or revoked key → `401`.
- The key is never accepted via query string, cookie, or request body.
- Failed attempts are rate-limited by client IP, separately from the normal
  per-route usage limit, to slow brute-force guessing.
- On success, the request acts as whichever user the key was minted for. This
  app is still single-user in the sense that all its data belongs to one
  account, but multiple independently-revocable keys (n8n, mobile, …) can now
  act on that account's behalf, each with its own rate-limit quota.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/integrations/accounts` | List accounts with card details (`creditMeta`), `smsLastFour` and `isArchived`; `?includeArchived=true` adds archived ones |
| POST | `/api/integrations/accounts` | Create an account; `balance` is the opening balance in cents (needs `Idempotency-Key`) |
| PATCH | `/api/integrations/accounts/[id]` | Edit name, color, icon, creditMeta, smsLastFour, isArchived. No balance field (needs `Idempotency-Key`) |
| DELETE | `/api/integrations/accounts/[id]` | Archive an account, returns `{id, archived: true}` (needs `Idempotency-Key`) |
| GET | `/api/integrations/transactions` | List transactions (filters + pagination) |
| POST | `/api/integrations/transactions` | Create a transaction (with recurrence fields it creates a series) |
| GET | `/api/integrations/transactions/recurring` | Recurring series, or `?upcoming=N` for unpaid installments due in 7 days |
| GET | `/api/integrations/transactions/recurring/[recurringId]` | Installments and summary of one series |
| DELETE | `/api/integrations/transactions/recurring/[recurringId]` | Cancel unpaid installments (needs `Idempotency-Key`) |
| GET | `/api/integrations/budgets` | List budgets with spend |
| PATCH | `/api/integrations/budgets/[id]` | Edit limitAmount, alertAt, isActive, rollover (needs `Idempotency-Key`) |
| DELETE | `/api/integrations/budgets/[id]` | Soft delete a budget (needs `Idempotency-Key`) |
| GET | `/api/integrations/goals` | List goals |
| PATCH | `/api/integrations/goals/[id]` | Edit a goal; completing it fires `goal_reached` (needs `Idempotency-Key`) |
| DELETE | `/api/integrations/goals/[id]` | Soft delete a goal (needs `Idempotency-Key`) |
| GET | `/api/integrations/credit-cards/summary` | Card dues, utilisation and totals for every card |
| GET | `/api/integrations/credit-cards/[accountId]/statements` | Open cycle plus past statements for one card (`{statements, currentCycle}`) |
| GET | `/api/integrations/credit-cards/rewards` | Every active card with its reward rule (or `null`) and the estimate for its current billing cycle; `currentValue` adds them up (paise) |
| GET, PUT, DELETE | `/api/integrations/credit-cards/[accountId]/rewards` | GET: the rule and what each billing cycle earned (`cycles` 1 to 12, default 3, current first). PUT replaces the rule, DELETE removes it (both need `Idempotency-Key`) |
| GET | `/api/integrations/stats` | Month totals, category breakdown, `daily` series; `months=2026-9,2026-10` adds `history` |
| GET | `/api/integrations/notifications` | Inbox list (`unread`, `skip`, `limit` max 50) with `unreadCount` |
| PATCH | `/api/integrations/notifications/[id]` | Mark read (default) or unread (needs `Idempotency-Key`) |
| POST | `/api/integrations/notifications/read-all` | Mark all read (needs `Idempotency-Key`) |
| GET, POST | `/api/integrations/rules` | List categorise rules in run order; create one (needs `Idempotency-Key`) |
| PATCH, DELETE | `/api/integrations/rules/[id]` | Edit (`null` clears category, merchantName, accountId) or delete a rule (need `Idempotency-Key`) |
| POST | `/api/integrations/rules/test` | `{merchant?, text?, upi?}` gives `{matched, rule?}` for the first matching active rule; read-only, no key needed |
| GET, POST | `/api/integrations/loans` | List loans (`direction`, `isSettled`), create one (needs `Idempotency-Key`) |
| GET, PATCH, DELETE | `/api/integrations/loans/[id]` | Read, edit, soft delete a loan (writes need `Idempotency-Key`) |
| GET, POST | `/api/integrations/loans/[id]/repayments` | List and record repayments (POST needs `Idempotency-Key`) |
| POST | `/api/integrations/transfers` | Move money between two own accounts: `{fromAccountId, toAccountId, amount (paise, int), date?, note?, description?}` (needs `Idempotency-Key`). Not income or spending |
| GET | `/api/integrations/cash` | The user's cash account (oldest live account of type `cash`) with a low-cash view: balance, low-cash line, `isLow`, 30 days of withdrawals and cash spending, latest withdrawals |
| POST | `/api/integrations/cash` | Make sure a cash account exists (created on first call, 201) and set `name` and `lowBalanceAt` (paise, `null` for the default); `openingBalance` counts only on creation (needs `Idempotency-Key`) |
| GET, PATCH, DELETE | `/api/integrations/transfers/[id]` | Read, edit (amount, accounts, date, notes; both balances are corrected) and delete a transfer, which puts both balances back (writes need `Idempotency-Key`) |
| GET | `/api/integrations/subscriptions` | Detected repeating charges (`status`, `includeLapsed`), with `totals`; see below |
| PATCH | `/api/integrations/subscriptions/[id]` | Confirm, dismiss or restore one (`{status}`, needs `Idempotency-Key`) |
| GET | `/api/integrations/tax?fy=2025` | Financial-year summary (April to March, user time zone): income, spending, saved, deductible spending by category, per month totals; see [api-contracts.md](api-contracts.md#tax) |
| GET | `/api/integrations/tax/export?fy=2025` | The same as a CSV file |
| GET, PUT | `/api/integrations/tax/settings` | The deductible category list; PUT needs `Idempotency-Key` |
| PATCH | `/api/integrations/tax/transactions/[id]` | `{deductible: true\|false\|null}` on one expense (needs `Idempotency-Key`) |
| GET | `/api/integrations/net-worth` | What the user owns minus what they owe, the rows behind it, a daily trend and the change (`range`); see below |
| GET, POST | `/api/integrations/net-worth/assets` | List and add manual assets (property, vehicle, gold, ...); POST needs `Idempotency-Key` |
| PATCH, DELETE | `/api/integrations/net-worth/assets/[id]` | Edit or archive one (needs `Idempotency-Key`) |
| GET | `/api/integrations/refunds` | Credits that look like the money back for an earlier expense, each with the expense it probably refunds |
| POST | `/api/integrations/refunds/[id]/confirm` | Link the credit to its expense, optional `{originalId}` (needs `Idempotency-Key`) |
| POST | `/api/integrations/refunds/[id]/reject` | Not a refund: drop the suggestion, or unlink a confirmed one (needs `Idempotency-Key`) |
| GET | `/api/integrations/spend-limit` | Daily and weekly limit settings, today and week progress, safe to spend, and `history` (the amounts over time, so a past day can be judged against the limit it had; a change applies from today) |
| PUT | `/api/integrations/spend-limit` | Set, change or clear the limits (needs `Idempotency-Key`) |
| GET | `/api/integrations/bills` | What is coming due: recurring payments, card statements, loans you owe. `days` 0 to 60, default 14; overdue from the last 60 days included. Returns `{bills, settings, days}` |
| POST | `/api/integrations/bills/[id]/pay` | Mark a bill paid (needs `Idempotency-Key`; optional `{amount, accountId}` for loans). Cards answer 400 `NOT_PAYABLE` |
| GET, PATCH | `/api/integrations/bills/settings` | Reminder settings `{enabled, leadDays}` (off by default, `leadDays` 1 to 14); PATCH changes only what is sent (needs `Idempotency-Key`) |
| GET | `/api/integrations/forecast` | Cash flow forecast: balance of the money in hand day by day, the lowest point and whether it goes below zero. `days` 1 to 60, default 30 |
| GET, POST | `/api/integrations/sinking-funds` | List sinking funds (with computed progress and `totals`), create one (needs `Idempotency-Key`); see below |
| GET, PATCH, DELETE | `/api/integrations/sinking-funds/[id]` | Read, edit (name, target, due date, monthly plan), soft delete a fund (writes need `Idempotency-Key`) |
| POST | `/api/integrations/sinking-funds/[id]/contribute` | `{amount}` in paise: positive saves into the fund, negative takes out (balance stops at 0); needs `Idempotency-Key` |
| GET | `/api/integrations/savings-rate` | Share of income saved per month, average and trend; `months` 1 to 24, default 6; see below |
| GET | `/api/integrations/weekly-review` | The look back at one week (Monday to Sunday on the user's clock). `week=YYYY-MM-DD` is any date inside the week; default the last completed week |
| GET, PATCH | `/api/integrations/weekly-review/settings` | Notification settings `{enabled, day}` (off by default, `day` 0 Sunday to 6, default 1); PATCH changes only what is sent (needs `Idempotency-Key`) |
| GET | `/api/integrations/summary` | Snapshot: accounts, monthly stats, budgets |
| POST | `/api/integrations/sms` | Parse a bank/NBFC SMS and create a transaction or loan repayment |

### GET /api/integrations/forecast

The expected balance of the money in hand (bank, cash, wallet and savings accounts) over the next days. Query: `days`, a whole number from 1 to 60 (default 30); anything else is `400 VALIDATION_ERROR`.

```json
{ "success": true, "data": {
  "days": 30, "generatedAt": "2026-10-24T04:30:00.000Z", "timeZone": "Asia/Kolkata", "currency": "INR",
  "startingBalance": 1000000, "endBalance": 300000,
  "lowest": { "date": "2026-10-27", "balance": -200000 },
  "goesNegative": true, "firstNegativeDate": "2026-10-27",
  "points": [{ "date": "2026-10-24", "balance": 1000000, "change": 0 }, { "date": "2026-10-25", "balance": 990000, "change": -10000 }],
  "events": [{ "date": "2026-10-27", "kind": "recurring", "label": "Rent", "amount": -300000 }],
  "totals": { "inflows": 500000, "outflows": 300000, "dailySpendTotal": 290000 },
  "inputs": { "accounts": 1, "lookbackDays": 30, "dailyAverageSpend": 10000, "recurringCount": 2, "billCount": 0,
              "subscriptionCount": 0, "assumptions": ["Counts bank, cash, wallet and savings accounts; ..."] }
}, "requestId": "..." }
```

Amounts are paise. `inputs.dailyAverageSpend` is the average of the last 30 days of everyday expenses on those accounts (voided rows and subscription merchants left out), with confirmed refunds netted off when the expense they refund is in that same count (a refund into another account, or for a purchase older than the window, does not lower it); it is never negative, and it is the value the forecast applies. `points` has one entry per day, today first, each the balance at the end of that day in the user's time zone (`preferences.timezone`); `change` is what moved that day (events plus the daily spend). `events` are the known items used, soonest first: `kind` is `recurring` (unpaid recurring payments and income), `card` (the next unpaid card statement), `loan` (a loan the user owes) or `subscription` (a detected subscription, repeated by its cadence). Something overdue counts today. The daily spend (`inputs.dailyAverageSpend`) is the average of the last 30 days of everyday expenses on those accounts, not counting subscriptions and recurring payments, and is applied from tomorrow on. Money other people owe the user is not counted. `inputs.assumptions` says all this in words for the screen. Cards, investments and archived accounts are not part of the starting balance. No accounts gives a zero forecast.

### GET /api/integrations/subscriptions

Repeating charges found in the user's expense history. Query: `status` (`detected`, `confirmed`, `dismissed`, `all`; default hides dismissed) and `includeLapsed=true`.

```json
{ "success": true, "data": {
  "subscriptions": [{
    "id": "9f2c4a1b7d3e8a60", "merchant": "Netflix", "category": "entertainment",
    "accountId": "...", "cadence": "monthly",
    "amount": 64900, "lastAmount": 64900,
    "firstDate": "2026-07-05T00:00:00.000Z", "lastDate": "2026-10-05T00:00:00.000Z", "nextDate": "2026-11-05T00:00:00.000Z",
    "occurrences": 4, "monthlyCost": 64900, "yearlyCost": 778800,
    "active": true, "status": "detected"
  }],
  "totals": { "count": 1, "monthly": 64900, "yearly": 778800 }
}, "requestId": "..." }
```

Amounts are cents. `cadence` is `weekly`, `monthly`, `quarterly` or `yearly`. `active` is false once the next charge is more than a quarter of a cycle overdue (hidden unless `includeLapsed=true`). `totals` count active, non-dismissed ones. A charge needs 4 repeats weekly, 3 monthly or quarterly, 2 yearly, with at least 75% of gaps and amounts fitting.

`PATCH /api/integrations/subscriptions/{id}` with `{"status":"confirmed"|"dismissed"|"detected"}` and an `Idempotency-Key` returns the updated item. `400 VALIDATION_ERROR` for a bad id, status or missing key, `404 NOT_FOUND` if the id is not a current detection of this user. Realtime resource: `subscriptions`.

### Sinking funds

Money put aside for a cost with a due date (insurance, tax, travel). Amounts are paise. `POST /api/integrations/sinking-funds` body (needs `Idempotency-Key`):

```json
{ "name": "Car insurance", "targetAmount": 1200000, "dueDate": "2026-12-15T00:00:00.000Z", "savedAmount": 200000, "monthlyAmount": 150000, "icon": "car" }
```

`savedAmount` (default 0), `monthlyAmount` (your plan) and `icon` are optional. Every read returns each fund as:

```json
{ "id": "...", "name": "Car insurance", "targetAmount": 1200000, "savedAmount": 200000, "currency": "INR",
  "dueDate": "2026-12-15T00:00:00.000Z", "monthlyAmount": 150000, "icon": "car",
  "isCompleted": false, "completedAt": null, "createdAt": "...", "updatedAt": "...",
  "remaining": 1000000, "percent": 16, "monthsLeft": 2, "suggestedMonthly": 500000, "status": "behind" }
```

Computed on every read, never stored: `remaining` (never below 0), `percent` (whole, capped at 100), `monthsLeft` (calendar months from this month to the due month, 0 in the due month or later), `suggestedMonthly` (`remaining` over the months left, rounded up; all of it when none are left; 0 when done) and `status`: `done` (saved reached the target), `overdue` (due date passed), `on_track` (saved is at least what a straight line from creation to the due date would have by now) or `behind`. `GET` answers `{funds, totals}` (soonest due first) where `totals` is `{count, targetAmount, savedAmount, remaining, monthlyNeeded}`; `monthlyNeeded` adds, for funds not done, the fund's own `monthlyAmount` or else its `suggestedMonthly`.

`PATCH /sinking-funds/{id}` takes any of `name`, `targetAmount`, `dueDate`, `monthlyAmount` (`null` clears the plan), `icon` (at least one; `savedAmount` is not editable here). Changing the target can finish or reopen the fund. `POST /sinking-funds/{id}/contribute` with `{"amount": 25000}` adds, `{"amount": -5000}` takes out; it is atomic, so two phones saving at once both count, and a retried request with the same key adds once. Reaching the target stamps `completedAt` and creates one `goal_reached` notification (`meta.sinkingFundId`); taking money out reopens it. Errors: `400 VALIDATION_ERROR` (bad id, body, amount 0 or fractional, missing key), `404 NOT_FOUND` (not yours, or deleted), `409 IDEMPOTENCY_CONFLICT`. Browser equivalents (session auth, `{data}`): `/api/sinking-funds`, `/api/sinking-funds/:id`, `/api/sinking-funds/:id/contribute`.

### GET /api/integrations/savings-rate

`months` (1 to 24, default 6; anything else is `400`). Month totals come from the same numbers as every other stat, so transfers between accounts never count and a confirmed refund comes off spending.

```json
{ "success": true, "data": {
  "months": [{ "year": 2026, "month": 9, "income": 100000, "expense": 80000, "saved": 20000, "rate": 0.2 },
             { "year": 2026, "month": 10, "income": 100000, "expense": 40000, "saved": 60000, "rate": 0.6 }],
  "current": { "year": 2026, "month": 10, "income": 100000, "expense": 40000, "saved": 60000, "rate": 0.6 },
  "average": { "income": 200000, "expense": 120000, "saved": 80000, "rate": 0.4 },
  "trend": "up"
}, "requestId": "..." }
```

`months` is oldest first and ends with the month in progress. `saved` is income minus spending (negative when more was spent than earned). `rate` is `saved` over `income` as a fraction rounded to 4 decimals, `null` for a month with no income. `average` adds the whole window together first. `trend` compares the average rate of the latest 3 months with the 3 before (months with income only; with fewer, the latest month against the earliest): `up` or `down` for a move of more than 2 points, else `flat`; `null` when fewer than 2 months have income. Browser equivalent: `GET /api/savings-rate?months=`.

### GET /api/integrations/net-worth

Query: `range` = `30d`, `90d` (default), `1y` or `all`. Reading it also stores today's point (the user's local day).

```json
{ "success": true, "data": {
  "assets": 280000, "liabilities": 60000, "netWorth": 220000,
  "breakdown": {
    "assets": [{ "key": "bank", "label": "Bank accounts", "amount": 100000, "count": 1 }],
    "liabilities": [{ "key": "cards", "label": "Credit cards", "amount": 30000, "count": 1 }]
  },
  "range": "90d",
  "history": [{ "date": "2026-10-20", "assets": 250000, "liabilities": 60000, "netWorth": 190000 }],
  "change": { "amount": 30000, "percent": 15.8, "since": "2026-10-20" }
}, "requestId": "..." }
```

Amounts are cents. Asset keys: `bank`, `savings`, `cash`, `wallet`, `investment`, `cardCredit`, `loansGiven`, `manual`; liability keys: `cards`, `overdrafts`, `loansReceived`; rows with nothing in them are left out, in that order. `history` is oldest first and its last point is today; `change` compares now with the first point (`since` is null when there is only today, `percent` is null when that point was 0). Points are stored once per local day (last write wins), by this read and by `GET /api/cron/net-worth-snapshot` (a user who once had a point and now has nothing still gets today's zero; one run at a time per process) (every 3 hours from `server.ts`; on Vercel call it from a scheduler with `Authorization: Bearer $CRON_SECRET`).

`POST /api/integrations/net-worth/assets` takes `{name, kind?, value, note?}` (needs `Idempotency-Key`) and returns `201` with `{id, name, kind, value, note, createdAt, updatedAt}`. `PATCH .../assets/{id}` takes any of those (`note: null` clears it); `DELETE` archives and returns `{id, deleted: true}`. `400 VALIDATION_ERROR` for bad data, a bad id or a missing key; `404 NOT_FOUND` for an unknown or another user's asset; `409 IDEMPOTENCY_CONFLICT` when a key is reused with a different request.

### Categorise rules

`POST /api/integrations/rules` body (needs `Idempotency-Key`):

```json
{ "field": "upi", "op": "contains", "value": "swiggy@icici", "category": "food", "merchantName": "Swiggy", "tags": ["delivery"], "priority": 100 }
```

- `field`: `merchant` (a bank message's merchant, or a manual add's description), `upi` (a UPI id found in the merchant or the text) or `text` (the whole message, or description plus note). `op`: `contains` (default) or `equals`, case-insensitive.
- Give at least one of `category`, `merchantName`, `accountId`, `tags`. `accountId` is used only for a capture that matched none of your accounts.
- Response `201` `data`: `{id, field, op, value, category, merchantName, accountId, tags, priority, isActive, createdAt, updatedAt}`. `GET` returns an array of these in run order.
- Rules run in `priority` order (lower first, then oldest); the first match wins. They apply when a bank message becomes a transaction and when a plain transaction is added by hand (`POST /api/integrations/transactions` and the browser route). They fill a category still set to `other` and a merchant name that came from a bank message, and add tags. A category or description you set is never changed. Transfers, splits and recurring series are never touched.
- Errors: `VALIDATION_ERROR` (nothing to set, bad value), `NOT_FOUND` (rule, or an account that is not yours), `CONFLICT` (a rule with the same field, op and value exists, or 200 rules reached).
- `POST /api/integrations/rules/test` with `{ "merchant": "SWIGGY INSTAMART" }` returns `{ "matched": true, "rule": { "ruleId", "category", "merchantName", "accountId", "tags" } }` or `{ "matched": false }`; nothing is written.

### GET /api/integrations/transactions

Query params: `type`, `category`, `accountId`, `search`, `dateFrom`, `dateTo`,
`skip` (default 0), `limit` (default 20, max 100), `hideFuture`,
`includeUnpaidRecurring`.

### POST /api/integrations/transactions

Money is **integer cents** (matches the app's internal representation) — do
not send decimal rupees. E.g. ₹125.00 → `12500`.

Requires an `Idempotency-Key` header — see below. Body fields mirror the
browser transaction form:

```json
{
  "accountId": "6650...",
  "type": "expense",
  "amount": 12500,
  "category": "Groceries",
  "description": "Weekly shop",
  "date": "2026-09-05T00:00:00.000Z",
  "tags": ["whatsapp"]
}
```

curl example:

```bash
curl -X POST https://your-app.example.com/api/integrations/transactions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: whatsapp-message-12345" \
  -d '{
    "accountId": "6650aaaaaaaaaaaaaaaaaaaa",
    "type": "expense",
    "amount": 12500,
    "category": "Groceries",
    "description": "Weekly shop",
    "date": "2026-09-05T00:00:00.000Z"
  }'
```

Success response (`201`):

```json
{
  "success": true,
  "requestId": "…",
  "data": {
    "id": "…",
    "type": "expense",
    "amount": 12500,
    "currency": "INR",
    "category": "Groceries",
    "accountId": "…",
    "date": "2026-09-05T00:00:00.000Z",
    "seriesId": null,
    "count": 1,
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

### POST /api/integrations/sms

Accepts raw bank/NBFC transactional SMS text and turns it into real data —
without n8n (or a future phone app that auto-fetches SMS) ever needing to know
the message format. All parsing, matching, and creation happens server-side
in this one endpoint; the caller just forwards the text.

```json
{
  "text": "Happy Shopping! INR 896.15 spent on your IDFC FIRST Bank Credit Card ending XX1832 at PAYPAL *XINDAWNCOMP on 24 JUN 2026 at 04:04 PM Avbl Limit: INR 10309.48",
  "receivedAt": "2026-06-24T16:04:00.000Z"
}
```

`receivedAt` is optional (ISO 8601) — when omitted, "now" is used. `text` is
required, max 2000 characters.

The message is parsed server-side (`src/lib/capture/parsers/`): the Navi-style
EMI format, the IDFC card-spend format, and a generic parser for common
HDFC / ICICI / SBI / Axis / Kotak / UPI phrasing. The parsed last 4 digits are
matched to an account's "SMS match digits" (`smsLastFour`) or a card's
`creditMeta.lastFourDigits`; an EMI's loan account number to `Loan.externalLoanId`.

Anything uncertain is **never** guessed into a transaction: it goes to the
reconcile inbox (`/reconcile` in the web app, and the phone app's Review tab)
with a `system` notification + push. Transactions created from n8n start as
`reviewStatus: "unreviewed"` so the user can confirm or fix them, and every
fix is kept as a correction record. n8n counts as forwarded SMS: the phone's
own SMS capture ranks above it, a bank-app notification below it. Full rules:
[docs/reconcile.md](reconcile.md).

Dedupe no longer depends on the `Idempotency-Key`: every message's normalized
text hash is stored permanently, so the same SMS forwarded twice, or also
captured by the phone, never creates a second transaction (response
`status: "duplicate"`). The header is still accepted.

Newer response statuses besides `created` / `queued`: `updated` (200, replaced
values from a lower-priority source), `duplicate` (200), `ignored` (200, OTP /
offer / due reminder). The workflow's "Format SMS Reply" node currently treats
anything that isn't `created` as queued; see the suggested update in
[docs/reconcile.md](reconcile.md).

Success response — created (`201`):

```json
{ "success": true, "requestId": "…", "data": { "status": "created", "kind": "transaction", "id": "…" } }
```

or, for a matched loan repayment:

```json
{ "success": true, "requestId": "…", "data": { "status": "created", "kind": "repayment", "id": "…", "isSettled": false } }
```

Queued for review (`202`):

```json
{ "success": true, "requestId": "…", "data": { "status": "queued", "reviewItemId": "…" } }
```

curl example:

```bash
curl -X POST https://your-app.example.com/api/integrations/sms \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi Finserv loan account 010021753351 for October 2026."}'
```

There is no dedicated webhook for this — SMS text is sent the same way as any
other message, by forwarding/pasting the raw bank SMS into the WhatsApp or
Telegram chat this app's "Expense Assistant" n8n workflow already listens on.
Right after `Extract Message` (the node that normalizes both channels into
one shape), an `Is Bank SMS?` check looks for either `"loan account"` or
`"Credit Card ending"` in the message text:

- **No match** — the message goes into the existing AI intent flow
  (`Understand Message` → `Intent Router` → …) unchanged, exactly as before
  this feature existed.
- **Match** — it skips the AI entirely and goes straight to `Normalize SMS
  Payload` → `Submit SMS to API` (this endpoint) → `Format SMS Reply`, then
  joins the same `Merge` → `Route by Channel` → reply step every other intent
  branch uses, so you get a WhatsApp/Telegram reply back either way: a ✅
  confirmation, or a note that it was queued for review.

Because the check is a plain substring match on two exact phrases from the
two formats `sms-parser.ts` currently understands, a bank SMS with different
wording won't be detected as SMS at all — it'll fall through to the AI intent
flow instead (and most likely get misread as a normal expense message, or hit
"unknown intent"). Add its trigger phrase to the `Is Bank SMS?` condition
(and a new parser to `sms-parser.ts`) when a new bank/lender format shows up.

The `Submit SMS to API` node's credential (reusing the workflow's existing
"Header Auth account", `Authorization: Bearer <YOUR_API_KEY>`, minted via
`yarn api-keys create --label n8n --email <...>`) needs attaching
by hand in the n8n UI — the same one-time step every HTTP Request node in
this workflow needs; it isn't set automatically.

### Refunds and reversals

A captured credit that matches an earlier expense (same merchant once words like "refund", "pvt", "ltd" are ignored; the same or a smaller amount; within 60 days before the credit; the expense not yet refunded up to its amount) is marked `refundStatus: "suggested"` with `refundOf` pointing at the expense. Suggesting changes nothing in the stats or balances.

`GET /api/integrations/refunds` returns the suggestions, newest first:

```json
{ "success": true, "data": [ {
  "id": "<credit id>", "accountId": "...", "accountName": "HDFC Savings", "amount": 25000, "currency": "INR",
  "category": "other", "description": "Swiggy refund", "date": "2026-09-26T06:30:00.000Z", "status": "suggested",
  "original": { "id": "<expense id>", "accountId": "...", "accountName": "HDFC Savings", "amount": 25000, "currency": "INR", "category": "food", "description": "Swiggy", "date": "2026-09-24T06:30:00.000Z" }
} ], "requestId": "..." }
```

- `POST /api/integrations/refunds/:id/confirm` with an optional body `{ "originalId": "<expense id>" }` links the credit to that expense (the suggested one when omitted; a credit with no suggestion needs `originalId`). The refund takes the expense's category, and from then on it comes off expense and that category in `GET /api/integrations/summary`, `stats` and the budget `spent`, not onto income. Balances are not touched: the credit already raised the balance. Answers `{ "refund": { ...same shape, "status": "confirmed" } }`.
- `POST /api/integrations/refunds/:id/reject` drops a suggestion for good (the credit is not suggested again), or unlinks a confirmed refund and gives it back the category it had. Answers `{ "refund": { ..., "status": "rejected" } }`.
- Both writes need `Idempotency-Key`. Errors: `400` bad body or key, `404` credit or expense not found (also another user's), `409` already linked, no suggestion, the expense is already refunded up to its amount, or a credit linked to itself.
- The reconcile inbox (`GET /api/integrations/review`) adds `refundSuggestion` (the expense, same shape as `original`, or `null`) to each `needsReview` item.

## Idempotency

n8n/WhatsApp/AI workflows can retry a request (e.g. after a timeout with no
response received). `POST /api/integrations/transactions` requires an
`Idempotency-Key` header, scoped to the current user and this endpoint:

- First request with a key: executes normally, response is stored.
- Same key + identical body, retried: the stored response is replayed —
  **no second transaction is created**.
- Same key + a **different** body: rejected with `409 IDEMPOTENCY_CONFLICT`
  (a key must represent one operation).
- Two concurrent requests with the same new key: one wins and executes, the
  other gets `409 IDEMPOTENCY_CONFLICT` ("in progress; retry shortly") — there
  is no distributed lock, so the loser should retry after a short delay
  rather than assume failure.
- Keys expire after `N8N_IDEMPOTENCY_TTL_SECONDS` (default 24h); after that, the
  same key can be reused for a new operation.

Use a stable, unique identifier per real-world action as the key — e.g. the
WhatsApp message ID, or a workflow execution ID plus a step name.

## Errors

```json
{
  "success": false,
  "requestId": "…",
  "error": { "code": "VALIDATION_ERROR", "message": "Transaction data is invalid" }
}
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad/missing input |
| 401 | `UNAUTHORIZED` | Missing/invalid API key |
| 404 | `NOT_FOUND` | Referenced account doesn't exist |
| 409 | `IDEMPOTENCY_CONFLICT` | Key reuse conflict — see above |
| 429 | `RATE_LIMITED` | Rate limit exceeded (see `retryAfterSeconds`) |
| 500 | `INTERNAL_ERROR` | Unexpected server error (details never leaked) |

Every response includes a `requestId` (also as an `X-Request-ID` header) —
pass your own via an `X-Request-ID` request header to correlate n8n's own
execution log with this app's server logs, or let it be generated.

## Pagination

`GET /api/integrations/transactions` is paginated (`skip`/`limit`, max 100 per
page) — there is no "return everything" mode.

## Caching

Only `GET /api/integrations/summary` is cached (the same Redis key/TTL as the
existing `/api/transactions/stats`, 5 minutes), scoped per user. Accounts,
budgets, goals, and the transaction list are uncached, matching the existing
browser routes. If Redis is unavailable, all routes degrade gracefully — you
simply don't get a cache hit.

## Rate limits

Each route allows `N8N_RATE_LIMIT` requests per `N8N_RATE_WINDOW_MS` window,
per route, **scoped per API key** — n8n and the mobile app (or any other
caller) each get their own quota even when acting on the same account.
Authentication failures have a separate, fixed limit (10 per 10 minutes per
source IP) that is not configurable, since it's a security control rather
than a usage quota.

## Security notes

- Keys are stored as a sha256 hash only (`api_keys` collection) — the raw
  value is shown once at creation and is not recoverable afterwards. Losing
  it means revoking it and minting a new one.
- The key and the `Authorization` header value are never logged, in success
  or failure.
- Errors never include stack traces, MongoDB error details, file paths, or
  environment variables.
- Idempotency records store only the minimal response fields returned to the
  caller — never full account/transaction documents.
- Each key is independently revocable (`yarn api-keys revoke --id ...`)
  without affecting any other caller's key.

## App updates

The Android companion app is sideloaded and its releases are assets of a
private GitHub repo. The phone cannot read them (and must not hold a token), so
it asks these two routes. Both use the normal API-key auth and rate limit.

`GET /api/integrations/app-update`

```json
{ "success": true, "data": {
    "configured": true,
    "latest": { "version": "1.1.0", "build": 11, "notes": "...", "publishedAt": "2026-10-16T08:00:00Z",
                "sizeBytes": 26214400, "sha256": "ab12..." } } }
```

`latest` is `null` when `APP_RELEASES_TOKEN` is not set, no release exists, or
GitHub is unreachable (the last good answer is served for a while). The phone
compares `build` with its own versionCode.

`GET /api/integrations/app-update/download`

```json
{ "success": true, "data": { "url": "https://...signed...", "build": 11, "sizeBytes": 26214400, "sha256": "ab12..." } }
```

`url` is a signed GitHub storage link that expires within minutes; the phone
downloads from it directly with no credentials, so no APK bytes pass through
this server. `404 NOT_FOUND` when there is no release.

Only releases tagged `vMAJOR.MINOR.PATCH+BUILD` with one `.apk` asset, and that
are neither drafts nor prereleases, count. The mobile repo's CI publishes them
in exactly that shape. Release lookups are cached for 5 minutes.


## Bills and reminders

`GET /api/integrations/bills` returns one list of bills, soonest first (overdue at the top):

```json
{ "bills": [{ "id": "recurring:66f0...", "kind": "recurring", "title": "Rent", "amount": 1200000, "currency": "INR",
              "dueDate": "2026-10-27T00:00:00.000Z", "daysUntil": 3, "status": "upcoming", "accountId": "66e0...",
              "canMarkPaid": true, "recurringId": "66d0..." }],
  "settings": { "enabled": false, "leadDays": 3 }, "days": 14 }
```

- `kind` is `recurring` (an unpaid expense installment), `card` (the oldest unpaid statement of a credit card) or `loan` (an unsettled loan you received, with a due date). `id` is `recurring:<installmentId>`, `card:<accountId>:<statement close date>` or `loan:<loanId>`; pass it to `/pay` URL-encoded.
- `status` is `upcoming`, `due_today` or `overdue`; `daysUntil` is whole days on the user's wall clock (`preferences.timezone`) and negative once overdue. `amount` is in minor units.
- `/pay` marks a recurring payment paid through the same code as the installment route (balance and ledger updated), or records a loan repayment (full amount left unless `amount` is sent; `accountId` also records the transaction). A card statement cannot be marked paid here: record the payment on the card.
- Errors: 400 `VALIDATION_ERROR` with `error.reason` `INVALID_BILL`, `NOT_PAYABLE` or `ALREADY_PAID`; 404 `NOT_FOUND` for a bill that is not the user's.
- Reminders: with `enabled`, a notification (and push) is created once per bill per due date when it comes within `leadDays`, from 09:00 on the user's clock, plus one more when it goes overdue. Types are `emi_due` (recurring), `credit_due` (card) and `loan_due`; `meta.kind` is `bill_reminder`. For these users the older EMI day-before and card due-soon pushes stand down so nothing arrives twice. The job runs every 30 minutes from `server.ts`; on Vercel call `GET /api/cron/bill-reminders` with `Authorization: Bearer $CRON_SECRET` from a scheduler every 30 minutes (safe to call often).

## Card rewards

A credit card can carry one reward rule. `PUT /api/integrations/credit-cards/[accountId]/rewards` replaces it:

```json
{ "kind": "cashback", "baseRate": 1.5, "categoryRates": [{ "category": "fuel", "rate": 5 }], "cap": 100000 }
```

- `kind` is `cashback` or `points`. `baseRate` and each category `rate` have at most two decimals: for cashback a percent of spend (0 to 100), for points the points earned per 100 rupees (0 to 1000). A category rate wins over the base rate (names are lowercased, matched case-insensitively against the transaction's category). At most 30 category rates, none listed twice.
- `cap` (optional, `null` for none) is a whole number per billing cycle: paise for cashback, points for points. `pointValue` (points only, optional) is paise per point; without it a point is worth 25 paise.
- Rounding: each transaction is rounded down on its own, in whole paise (cashback) or whole points. Only expenses on that card earn. A confirmed refund (see Refunds) takes back exactly what the same amount would have earned, so a full refund cancels its purchase. Transfers, card payments and unconfirmed refund suggestions are ignored. The cap applies to the net total of a billing cycle, and the total never goes below 0.
- `GET .../[accountId]/rewards?cycles=3` answers `{accountId, name, lastFourDigits, rule, reason, cycles, total}`. `reason` is `no_rule` or `billing_cycle_not_set` when there is no estimate (then `cycles` is empty and `total` is `null`), otherwise `null`. Each cycle is `{label, periodStart, periodEnd, dueDate, isCurrent, unit: "paise" | "points", spend, refunded, uncapped, earned, capReached, value, byCategory: [{category, rate, spend, earned}]}`; `value` is always paise (points times the point value). Cycles are the card's billing cycles (the same ones as its statements), current first.
- Errors: 400 `VALIDATION_ERROR` for an invalid rule, a missing `Idempotency-Key`, a bad `cycles`, or an account that is not a credit card; 404 `NOT_FOUND` for a card that is not the user's or is archived; 409 `IDEMPOTENCY_CONFLICT` for a key reused with a different rule.
- The rule is a field on the account, so a change shows up on the `accounts` realtime resource. The browser has the same routes under `/api/credit-cards/rewards` and `/api/credit-cards/[accountId]/rewards` (session auth, bare JSON).

## Weekly review

`GET /api/integrations/weekly-review?week=2026-10-19` looks back at one week: Monday to Sunday on the user's wall clock (`preferences.timezone`). `week` is any date inside the wanted week; without it, the last completed week. A week that has not started is refused (400 `VALIDATION_ERROR`, `details.code` `FUTURE_WEEK`), a bad date likewise (`INVALID_WEEK`). The week in progress is allowed and comes back with `isComplete: false`.

```json
{ "week": { "start": "2026-10-18T18:30:00.000Z", "end": "2026-10-25T18:30:00.000Z", "startDate": "2026-10-19",
            "endDate": "2026-10-25", "timeZone": "Asia/Kolkata", "isComplete": true },
  "totals": { "spent": 440000, "income": 900000, "net": 460000, "previousSpent": 400000,
              "change": { "amount": 40000, "percent": 10 } },
  "topCategories": [{ "category": "Shopping", "total": 250000, "share": 57 }],
  "topMerchants": [{ "merchant": "Amazon", "total": 250000, "count": 1 }],
  "biggestExpense": { "id": "66f0...", "amount": 250000, "description": "Amazon", "category": "Shopping", "date": "2026-10-21T06:30:00.000Z" },
  "days": [{ "date": "2026-10-19", "spent": 0 }],
  "noSpendDays": 3,
  "budgets": { "month": 10, "year": 2026, "asOf": "2026-10-27T04:30:00.000Z", "total": 2, "over": 1, "near": 0,
               "items": [{ "category": "Food", "spent": 170000, "limit": 100000, "percent": 170 }] },
  "spendLimit": { "dailyAmount": 100000, "daysWithin": 6, "daysOver": 1, "daysTracked": 7 },
  "unreviewed": 2,
  "highlights": ["You spent ₹400.00 more than the week before (up 10%)."],
  "settings": { "enabled": false, "day": 1 } }
```

- Amounts are in minor units. `topCategories` and `topMerchants` hold at most three, largest first; `share` is a whole percent of `spent`. `days` always has seven entries, Monday first.
- Transfers are neither spending nor income, voided rows are left out, a confirmed refund comes off `spent` and its category (not onto income), and a recurring installment counts when it was paid.
- `noSpendDays` counts finished days with no spending. `spendLimit` follows the daily spend limit's own rule (expenses that are not recurring bills and not in an excluded category) and judges each finished day against the limit in force that day; `null` when no limit was ever set or no day has finished. `budgets` is the active budgets of the month the week ends in, as of `asOf` (spending after the week is included), `null` without any. `unreviewed` is the review queue size now (capped at 100).
- `highlights` is at most two plain sentences: the change on the week before (10% or more), how the daily limit held, no-spend days, the top category (30% or more of spending). An empty week says "No spending recorded this week."
- `PATCH /weekly-review/settings` takes `enabled` (boolean) and/or `day` (whole number 0 to 6) and changes only what is sent.
- Notification: with `enabled`, a notification (type `system`, `meta.kind` `weekly_review`, title "Your week in review") and push are created once per week, on the chosen weekday from 09:00 on the user's clock, for the last completed week. A week with no spending and no income sends nothing. The job runs every 30 minutes from `server.ts`; on Vercel call `GET /api/cron/weekly-review` with `Authorization: Bearer $CRON_SECRET` from a scheduler every 30 minutes (safe to call often).
