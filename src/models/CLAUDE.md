# src/models
Purpose: Mongoose schemas, one file per collection. Field tables: [docs/database-schema.md](../../docs/database-schema.md).

## Files
- User (incl. `preferences.timezone`, `preferences.billReminders` and `preferences.weeklyReview`), Session (collection `userSession`), ApiKey: identity and access.
- Account (cash accounts also carry `lowBalanceAt`; credit cards may carry `rewardRule`), Transaction (also `refundOf`, `refundStatus` for refund matching), TransactionCorrection, CreditStatement: money records and corrections.
- Budget, SpendLimit (one doc per user: daily and weekly limit, plus `limitHistory` of the amounts over time), SubscriptionDecision (confirm or dismiss choice per detected subscription), ManualAsset (property, gold and so on counted in net worth; archived, not deleted), NetWorthSnapshot (one row per user per local day for the net worth trend), Goal, SinkingFund (money set aside for a cost on a due date), Loan, Repayment, Rule (categorise rules; hard-deleted), Notification, PushSubscription: feature data.
- CapturedMessage, IdempotencyRecord: bank message inbox; integration idempotency.
- LedgerBlock, LedgerBackfill, LogSecurity, LogUnlockSession, SecurityRateLimit: ledger chain, logs unlock, rate limits.
- Shared TypeScript shapes live in src/types/models.ts.

## Talks to
- Used by src/lib services and src/app/api routes; read by change streams (see src/lib/realtime/changes.ts).

## Rules and gotchas
- Export with the `models.X || model(...)` cache pattern, with an explicit collection name.
- Money is integer cents.
- Soft delete via `isDeleted` (transactions, budgets, goals, loans) or `isArchived` (accounts). Realtime relies on this: hard deletes are not broadcast.
- Realtime filters on a top-level `user` field; a watched model without it will not stream.
- `CapturedMessage`: unique {user, contentHash}, no TTL, text encrypted. `TransactionCorrection`: insert-only.
- TTLs: Notification 90 days, Session 90 days, IdempotencyRecord and LogUnlockSession and SecurityRateLimit at `expiresAt`.
- docs/database-schema.md calls the Session collection `userSessions`; the code says `userSession`.

## Tests
- Exercised through `src/test/integrations.test.ts`.

## Last changed
- 52f3dea feat(capture): match bank SMS to an account by bank when no digits are saved
