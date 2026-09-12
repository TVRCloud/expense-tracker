# n8n Integration

A dedicated API surface under `/api/integrations/*` lets an external n8n instance
read and record data in this app without ever touching MongoDB directly. Every
integration route calls the same business logic the browser app uses (account
balance updates, ledger entries, budget alerts, recurring handling) — n8n
cannot bypass or duplicate that logic.

## Configuration

Set in your environment (never commit real values):

```
N8N_API_KEY=<a long random secret, e.g. `openssl rand -hex 32`>
N8N_USER_EMAIL=<the email of the app's single user account>
N8N_RATE_LIMIT=30            # requests per window per route (default 30)
N8N_RATE_WINDOW_MS=60000     # window length in ms (default 60000)
N8N_IDEMPOTENCY_TTL_SECONDS=86400  # how long idempotency records live (default 24h)
```

## Authentication

Every request must include:

```
Authorization: Bearer <YOUR_N8N_API_KEY>
```

- Missing or malformed header → `401`.
- Wrong key → `401`.
- The key is never accepted via query string, cookie, or request body.
- Failed attempts are rate-limited by client IP, separately from the normal
  per-route usage limit, to slow brute-force guessing.
- On success, the request acts as the single user identified by
  `N8N_USER_EMAIL`. There is no per-request user selection — this app is
  single-user by design.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/integrations/accounts` | List accounts |
| GET | `/api/integrations/transactions` | List transactions (filters + pagination) |
| POST | `/api/integrations/transactions` | Create a transaction |
| GET | `/api/integrations/budgets` | List budgets with spend |
| GET | `/api/integrations/goals` | List goals |
| GET | `/api/integrations/summary` | Snapshot: accounts, monthly stats, budgets |
| POST | `/api/integrations/sms` | Parse a bank/NBFC SMS and create a transaction or loan repayment |

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
  -H "Authorization: Bearer <YOUR_N8N_API_KEY>" \
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

Two message formats are currently recognized (see
[`src/lib/integrations/sms-parser.ts`](../src/lib/integrations/sms-parser.ts)):

- **Credit card spend** — `"INR <amount> spent on your <bank> Credit Card
  ending XX<last4> at <merchant> on <date>"`. Matched to the Account whose
  `creditMeta.lastFourDigits` equals `<last4>`; on match, creates an expense
  Transaction on that account.
- **Loan EMI payment** — `"Rs.<amount>/- received towards <lender> loan
  account <id> for <month year>"`. Matched to the Loan whose `externalLoanId`
  equals `<id>` (set on the loan in the Loans page — see
  [docs/pages/06-loans.md](pages/06-loans.md)); on match, creates a Repayment
  and reduces the loan's `remainingAmount`.

An unrecognized message, or one that parses but matches no account/loan, is
**never** guessed into a transaction — it's stored in the `sms_review_items`
collection (`status: "pending"`, TTL 30 days) and a `system` notification +
push is sent to the user, so a person confirms or discards it instead of the
API silently creating (or silently dropping) real financial data. Read the
queue with `GET /api/sms-review` (browser session auth, not part of the
`/api/integrations/*` surface); discard an item with `DELETE
/api/sms-review/:id`. There is no auto-apply-from-queue endpoint yet.

Idempotency works the same as `POST /api/integrations/transactions`, but the
`Idempotency-Key` header is **optional** here: when omitted, the key defaults
to a SHA-256 hash of the message text itself, so the same SMS forwarded twice
(a common failure mode for SMS-forwarding tools) never creates a duplicate
transaction/repayment, with no extra setup required on the caller's side.

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
  -H "Authorization: Bearer <YOUR_N8N_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi Finserv loan account 010021753351 for October 2026."}'
```

SMS is one more input channel into the same "Expense Assistant" n8n workflow
that already handles WhatsApp/Telegram — not a separate workflow. It adds a
`SMS Webhook` trigger → `Normalize SMS Payload` → `Submit SMS to API` →
`Respond With SMS Result` branch alongside the existing WhatsApp/Telegram
triggers, reusing the workflow's existing "Header Auth account" credential
for both the inbound webhook's shared secret and the outbound
`Authorization: Bearer <N8N_API_KEY>` call to this endpoint — no new
credential to create. The `Submit SMS to API` node's credential still needs
attaching by hand in the n8n UI (same one-time step every HTTP Request node
in this workflow needs).

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
per route, scoped to the single user. Authentication failures have a
separate, fixed limit (10 per 10 minutes per source IP) that is not
configurable, since it's a security control rather than a usage quota.

## Security notes

- The API key is compared with a timing-safe comparison, never a plain string
  equality check.
- The key and the `Authorization` header value are never logged, in success
  or failure.
- Errors never include stack traces, MongoDB error details, file paths, or
  environment variables.
- Idempotency records store only the minimal response fields returned to the
  caller — never full account/transaction documents.
