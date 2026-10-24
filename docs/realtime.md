# Realtime (SSE + MongoDB change streams)

The old socket.io setup (custom `server.ts`) is gone from the runtime path; Vercel can't host persistent servers. Realtime is now Server-Sent Events fed by a MongoDB change stream. Events only say *which resource changed*; clients refetch. No data travels on the stream.

## Server

- `src/lib/realtime/changes.ts` — `RESOURCES` allow-list, `collectionToResource()`, `buildPipeline(userObjectId)`, `watchUserChanges()`.
- `src/lib/realtime/sse.ts` — builds the SSE `Response` shared by both routes.
- ONE `db.watch()` per connection, `fullDocument: "updateLookup"`, filtered by `ns.coll` in the allow-list, `operationType` in insert/update/replace, and `fullDocument.user === <caller>`.
- Deletes are dropped (they carry no `fullDocument`, so they can't be attributed and used to be broadcast to all users). Transactions, budgets, goals and loans are soft-deleted (`isDeleted`), which arrives as an update. Accounts are archived. Hard-deleted notifications (and 90-day TTL expiry) are not pushed.
- A dead cursor ends the SSE response so the client reconnects and refetches.

### Resources

| Resource | Collection | Notes |
|----------|-----------|-------|
| `transactions` | `transactions` | |
| `accounts` | `accounts` | |
| `budgets` | `budgets` | |
| `goals` | `goals` | |
| `loans` | `loans` | |
| `notifications` | `notifications` | |
| `captures` | `captured_messages` | SMS/bank captures (reconcile inbox) |
| `repayments` | `repayments` | Loan repayments |
| `statements` | `credit_statements` | Credit card statements |
| `spendLimits` | `spend_limits` | Daily and weekly spend limit settings |
| `subscriptions` | `subscription_decisions` | Confirm and dismiss choices on detected subscriptions |
| `sinkingFunds` | `sinking_funds` | Sinking funds, including saved amount changes |
| `netWorth` | `manual_assets` | Manual assets counted in net worth (other changes reach net worth through `transactions`, `accounts`, `loans`, `repayments`) |

Adding a resource: add it to `RESOURCES` (`src/lib/realtime/changes.ts`), to `MODELS` (`changed-since.ts`) and to `INVALIDATION_MAP` (`invalidation.ts`); the model needs a required `user` ObjectId. Installed apps accept any resource name and ignore the ones they do not know (`RealtimeDispatcher` in the app repo), so a new name is safe to ship before the app learns it.

Requires a replica set / Atlas (change streams).

## Endpoints

### `GET /api/events` (browser, NextAuth session via `requireAuth`)

`text/event-stream`. Each message has an incrementing `id:`.

- `event: ready` `data: {"resource":null}` once on open
- `event: data-changed` `data: {"resource":"<name>"}`
- `event: ping` `data: {}` every 20s

### `GET /api/integrations/events` (mobile app, API key)

Auth `Authorization: Bearer <key>`, same as other integration routes; 401 `UNAUTHORIZED` / 429 `RATE_LIMITED` use the integration error envelope. Same stream, contract is fixed:

- `event: ready` `data: {"now":<epoch ms>}`
- `event: data-changed` `data: {"resource":"transactions|accounts|budgets|goals|loans|notifications|captures|repayments|statements|spendLimits|subscriptions|sinkingFunds|netWorth"}`
- `event: ping` `data: {}` every 20s

### `GET /api/integrations/changes?since=<epoch ms>` (polling fallback)

`200 {"success":true,"data":{"now":<epoch ms>,"changed":["goals"]},"requestId":"..."}`, `Cache-Control: no-store`. A resource is listed if the caller has any doc with `updatedAt > since`. `now` is sampled before the queries; use it as the next `since`. No/invalid `since` gives `changed: []`. Hard-deleted notifications can't be detected. Index suggestion (not applied): `{ user: 1, updatedAt: -1 }` on the watched collections if the existence checks get slow.

## Web client

- `SocketProvider` owns the `EventSource` (`subscribe(event, handler)` and `onReconnect(handler)`).
- `RealtimeSync` (mounted once in `src/app/layout.tsx`) listens for `data-changed` and calls `invalidateForResource()`.
- Map in `src/lib/realtime/invalidation.ts`:

| Resource | Invalidated query keys |
|----------|------------------------|
| `transactions` | transactions, accounts, credit-summary, credit-statements, upcoming-installments, recurring-series, recurring-series-detail, budgets, spend-limit, analytics, reconcile, notifications, subscriptions, savings-rate, net-worth |
| `accounts` | accounts, credit-summary, credit-statements, net-worth |
| `budgets` | budgets, notifications |
| `goals` | goals, notifications |
| `sinkingFunds` | sinking-funds, notifications |
| `loans` | loans, accounts, notifications, net-worth |
| `notifications` | notifications |
| `captures` | reconcile, notifications |
| `repayments` | loans, accounts, notifications, net-worth |
| `statements` | credit-statements, credit-summary, notifications |
| `spendLimits` | spend-limit, budgets |
| `subscriptions` | subscriptions |
| `netWorth` | net-worth |

- Mutations call the same `invalidateForResource()` so the acting tab is correct before the event arrives.

## Reconnect behaviour

Vercel cuts the function at `maxDuration` (60s set on both stream routes; effective cap is plan-dependent). `EventSource` reconnects on its own. Events during the gap are lost, so every re-open after a drop runs `qc.invalidateQueries()` (everything). The mobile app should do the equivalent: on reconnect, call `/api/integrations/changes?since=<last now>` and refetch the listed resources.

## Polling fallback for the app

If SSE is unavailable, poll `GET /api/integrations/changes?since=<last now>` (e.g. every 15-30s while foregrounded), refetch the returned resources, and store the returned `now`.
