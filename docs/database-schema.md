# Database Schema

All monetary fields are stored as **integers (cents)** — divide by 100 for display.

## users

| Field | Type | Notes |
|-------|------|-------|
| `_id` | ObjectId | |
| `name` | String | required, max 100 |
| `email` | String | unique, required |
| `password` | String | bcrypt hash, 12 rounds |
| `role` | String | `"user"` \| `"admin"`, default `"user"` |
| `avatar` | String | URL |
| `isActive` | Boolean | default true |
| `preferences.theme` | String | `"light"` \| `"dark"` \| `"system"` |
| `preferences.language` | String | IETF tag |
| `preferences.pushNotifications` | Boolean | |
| `preferences.emailNotifications` | Boolean | |
| `preferences.weekStartsOn` | Number | 0=Sun, 1=Mon |
| `preferences.timezone` | String | IANA zone, default `Asia/Kolkata`; decides where a day starts for spend limits |
| `baseLocked` | Boolean | set atomically by the first write of any base-unit amount; once set the base currency cannot change |
| `preferences.currency` | String | ISO 4217, the base currency every `amount` is in; supported codes only, cannot change once the user has transactions |
| `preferences.billReminders.enabled` | Boolean | default false; turns on bill due reminders |
| `preferences.billReminders.leadDays` | Number | 1 to 14, default 3; how many days ahead to remind |
| `preferences.tax.deductibleCategories` | [String] | lower-case category names that count as deductible in the tax summary, up to 50 |
| `preferences.anomalies.enabled` | Boolean | default true; unusual-spend alerts |
| `preferences.anomalies.mutedCategories` | [String] | lower-case category names that raise no alerts, up to 50 |
| `preferences.weeklyReview.enabled` | Boolean | default false; turns on the weekly review notification |
| `preferences.weeklyReview.day` | Number | 0 (Sunday) to 6, default 1 (Monday); the weekday it arrives, from 09:00 on the user's clock |
| `passwordResetToken` | String | hashed, single-use |
| `passwordResetExpires` | Date | 1hr window |

## userSessions

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | ref: User |
| `jti` | String | unique, JWT ID |
| `isActive` | Boolean | set false to revoke |
| `ip` | String | |
| `userAgent` | String | |
| `expiresAt` | Date | TTL index (90 days) |

## accounts

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | ref: User |
| `name` | String | |
| `type` | String | `cash\|bank\|credit_card\|savings\|investment\|wallet` |
| `balance` | Number | cents, integer |
| `currency` | String | ISO 4217, supported codes only; a label for the account's own currency, `balance` stays in the user's base currency |
| `color` | String | hex |
| `icon` | String | |
| `isArchived` | Boolean | soft delete |
| `lowBalanceAt` | Number | cents; cash accounts only: at or under this the app shows low cash (unset = Rs 500 default) |
| `deletedAt` / `deletedBy` | Date / ObjectId | set with `isArchived` |
| `creditMeta` | Object | credit cards only: `creditLimit`, `billingCycleDay`, `paymentDueDay`, `apr`, `network`, `lastFourDigits`, `cardholderName`, `minPaymentPct` |
| `rewardRule` | Object | credit cards only: `kind` (`cashback` or `points`), `baseRate`, `categoryRates` `[{category, rate}]`, `cap`, `pointValue`. Cashback: rate is a percent, cap is cents; points: rate is points per 100 rupees, cap is points, `pointValue` is cents per point. Absent when the card has no rule |
| `smsLastFour` | [String] | 4-digit strings as shown in bank SMS (`A/c XX1234`), for matching captured messages |

Indexes: `{user, isArchived, createdAt}`, `{user, type}`, `{user, smsLastFour}`, `{user, creditMeta.lastFourDigits}`

## transactions

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | ref: User |
| `account` | ObjectId | ref: Account |
| `type` | String | `income\|expense\|transfer` |
| `amount` | Number | cents, always positive |
| `currency` | String | code of the base currency `amount` is in |
| `originalAmount` | Number | foreign spend only: minor units of `originalCurrency` |
| `originalCurrency` | String | foreign spend only: ISO 4217 |
| `originalExponent` | Number | foreign spend only: minor-unit digits of `originalCurrency` (JPY 0, USD 2, KWD 3) |
| `rate` | Number | foreign spend only: base units per 1 unit of `originalCurrency`, 10 significant digits |
| `rateDate` | Date | foreign spend only: when the provider published the rate; unset for a client rate |
| `rateSource` | String | foreign spend only: `provider\|client` |
| `category` | String | |
| `subcategory` | String | |
| `description` | String | full-text indexed |
| `note` | String | full-text indexed |
| `date` | Date | |
| `tags` | [String] | lower-case, at most 10 of 40 characters; tags with a colon are server link tags (`loan:`, `repayment:`, `credit_statement:`) |
| `transferTo` | ObjectId | ref: Account, only for transfers |
| `isRecurring` | Boolean | |
| `recurringId`, `recurrence*`, `installmentIndex`, `installmentStatus`, `paidAt` | | recurring series fields |
| `splitGroupId` | ObjectId | shared by split-purchase siblings (2 to 20 lines, amounts add up to the purchase) |
| `attachments` | [String] | ids of the `receipts` on this row, at most 5 |
| `source` | String | `manual\|sms\|notification\|n8n\|recurring\|import`, default `manual`. `import` rows come from the CSV import (`/api/integrations/import/commit`) |
| `sourceCapture` | ObjectId | ref: CapturedMessage, the message whose values are in use |
| `captures` | [ObjectId] | every captured message for this payment |
| `reviewStatus` | String | `unreviewed\|confirmed\|corrected\|voided`, null for manual rows |
| `refundOf` | ObjectId → Transaction | On an income row: the expense it refunds (suggested, confirmed or rejected) |
| `refundStatus` | String | `suggested\|confirmed\|rejected`, null otherwise. Only `confirmed` nets the pair out of stats and budgets |
| `refundPriorCategory` | String | The category before the expense's was carried over; restored when a confirmed refund is unlinked |
| `reviewedAt` / `reviewedBy` | Date / ObjectId | |
| `deductible` | Boolean | Tax helper override on an expense: `true` or `false` wins over the user's deductible categories, unset follows them |
| `isDeleted` | Boolean | soft delete |
| `deletedAt` | Date | |
| `deletedBy` | ObjectId | ref: User |

Indexes: `{user, isDeleted, date}` plus `{user, isDeleted, <account\|transferTo\|type\|category\|splitGroupId\|reviewStatus\|refundStatus>, date}`, sparse `{user, refundOf}`, sparse `{recurringId}` and `{splitGroupId}` (restore checks whether other people's rows use an id), recurring-series indexes, `{user, tags}`, full-text on `{description, note}`

## budgets

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `category` | String | |
| `month` | Number | 1–12 |
| `year` | Number | |
| `limitAmount` | Number | cents |
| `alertAt` | Number | percent, default 80 |
| `isActive` | Boolean | |

Unique index: `{user, category, year, month}`

## spend_limits

One document per user. Separate from `budgets` so the budgets list is unchanged for installed apps.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | unique |
| `dailyAmount` | Number | cents, unset = no daily limit |
| `weeklyAmount` | Number | cents, unset = no weekly limit |
| `alertAt` | Number | percent, default 80 |
| `excludeCategories` | String[] | never count against the limit |
| `rollover` | Boolean | yesterday's unspent or overspend moves today's limit (one day back) |
| `pausedUntil` | Date | limit suspended until then |
| `limitHistory` | `{from, dailyAmount?, weeklyAmount?}[]` | the amounts over time, oldest first. A change to `dailyAmount` or `weeklyAmount` applies from the start of that local day (a second change the same day replaces the entry). The first change writes a baseline entry at the epoch holding what was in force before. Empty for limits set before history existed: the current amounts then count for every earlier day |

## manual_assets

Something the user owns that is not an account (property, a vehicle, gold, shares held elsewhere). Counted in net worth. Archived, never deleted, so realtime sees the change.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `name` | String | 1 to 60 characters |
| `kind` | String | `property`, `vehicle`, `gold`, `investment`, `other` (default) |
| `value` | Number | cents, 0 or more |
| `note` | String | up to 200 characters, optional |
| `isArchived` | Boolean | true once removed |

## net_worth_snapshots

One row per user per local day: what net worth was the last time it was worked out that day. Written when net worth is read and by the snapshot cron. Unique on `{user, day}`.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `day` | String | `YYYY-MM-DD` on the user's clock (`preferences.timezone`) |
| `assets` | Number | cents |
| `liabilities` | Number | cents, positive |
| `netWorth` | Number | cents, assets minus liabilities |

## anomalies

Unusual-spend alerts ([src/lib/anomaly-service.ts](../src/lib/anomaly-service.ts)). Realtime resource `anomalies`. Kept 365 days.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `kind` | String | `large_spend`, `duplicate_charge`, `category_jump` |
| `transaction` | ObjectId | the expense (not set for a category jump) |
| `category` | String | |
| `amount` | Number | minor units of the base currency: the expense, or the month to date for a jump |
| `data` | Mixed | what the rule compared (typical amount, other transaction, baseline, month to date, month) |
| `status` | String | `open` (default), `dismissed`, `confirmed_mine`, `reported` |
| `dedupKey` | String | `large:<txn>`, `dup:<txnA>:<txnB>` (the two ids, sorted), `jump:<category>:<yyyy-mm>` |
| `resolvedAt` | Date | when it was answered or retired |

Indexes: unique `{user, dedupKey}` (one alert per cause, so a retry never alerts twice), `{user, status, createdAt}`, sparse `{user, transaction}`, TTL on `createdAt` (365 days).

## subscription_decisions

What the user chose about a detected subscription. Detections are never stored; they are worked out from `transactions` on every read.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `key` | String | merchant key plus cadence, e.g. `netflix|monthly` |
| `merchant` | String | display name when decided |
| `status` | String | `detected`, `confirmed`, `dismissed` (a row is updated, not deleted, when the user restores one) |

Unique index: `{user, key}`

## rules

Categorise rules ([src/lib/rule-service.ts](../src/lib/rule-service.ts)). Hard-deleted, no ledger block (configuration, not money). Not watched by realtime.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `field` | String | `merchant\|upi\|text`: what the rule looks at |
| `op` | String | `contains\|equals`, default `contains` |
| `value` | String | as typed, 2 to 120 chars |
| `valueKey` | String | lower-cased and trimmed `value`; what matching uses |
| `category` | String | set on the transaction (optional) |
| `merchantName` | String | clean name, set as the description (optional) |
| `account` | ObjectId | ref: Account; used only for a capture that matched no account (optional) |
| `tags` | String[] | added to the transaction's tags |
| `priority` | Number | default 100; lower runs first, then oldest |
| `isActive` | Boolean | default true |

A rule sets at least one of `category`, `merchantName`, `account`, `tags`. Unique index: `{user, field, op, valueKey}`. Index: `{user, priority, createdAt}`. At most 200 per user.

## loans

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `direction` | String | `given\|received` |
| `counterparty` | String | name |
| `principalAmount` | Number | cents |
| `remainingAmount` | Number | cents |
| `currency` | String | |
| `interestRate` | Number | percent |
| `startDate` | Date | |
| `dueDate` | Date | |
| `isSettled` | Boolean | |
| `note` | String | |
| `externalLoanId` | String | lender's own loan account number, e.g. from an EMI SMS; optional, used to auto-match incoming SMS to this loan |

Sparse index: `{user, externalLoanId}`

## repayments

| Field | Type | Notes |
|-------|------|-------|
| `loan` | ObjectId | ref: Loan |
| `user` | ObjectId | |
| `amount` | Number | cents |
| `date` | Date | |
| `note` | String | |
| `account` | ObjectId | ref: Account |

## receipts

A receipt photo on a transaction. The image is encrypted at rest and only leaves through an authenticated route that checks the owner; hard-deleted with its transaction.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | ref: User |
| `transaction` | ObjectId | ref: Transaction |
| `contentType` | String | `image/jpeg\|image/png\|image/webp\|image/heic`, from the file's bytes |
| `size` | Number | bytes of the original image, at most 3 MB |
| `iv`, `tag`, `data` | Buffer | AES-256-GCM. Key derived from `CAPTURE_ENCRYPTION_KEY` with a receipt label; `<user>:<receipt id>` is bound in as additional data, so a copied blob does not decrypt |

Index: `{user, transaction}`. Limits per user: 200 files, 150 MB. No new environment variable.

## goals

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `name` | String | |
| `targetAmount` | Number | cents |
| `savedAmount` | Number | cents |
| `currency` | String | |
| `targetDate` | Date | |
| `category` | String | |
| `icon` | String | |
| `roundUpEnabled` / `roundUpTo` | Boolean / Number | round expenses up into this goal |
| `isCompleted` / `completedAt` | Boolean / Date | |
| `isDeleted` / `deletedAt` / `deletedBy` | | soft delete |

## sinking_funds

Money set aside for a cost on a due date. Progress (`remaining`, `percent`, `monthsLeft`, `suggestedMonthly`, `status`) is computed on read, never stored.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `name` | String | |
| `targetAmount` / `savedAmount` | Number | cents |
| `currency` | String | |
| `dueDate` | Date | required |
| `monthlyAmount` | Number | the person's plan, cents; absent means use the suggested amount |
| `icon` | String | |
| `isCompleted` / `completedAt` | Boolean / Date | `savedAmount >= targetAmount`; kept in step by the service |
| `isDeleted` / `deletedAt` / `deletedBy` | | soft delete |

Index `{user, isDeleted, dueDate}`.

## notifications

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `type` | String | `budget_alert\|loan_due\|goal_reached\|system\|transaction` |
| `title` | String | |
| `body` | String | |
| `meta` | Mixed | type-specific payload |
| `isRead` | Boolean | |
| `createdAt` | Date | TTL 90 days |

Indexes: `(user, isRead, createdAt)`, `(user, type)`, the TTL on `createdAt`, and a unique partial index on `(user, meta.dedupKey)` limited to rows with `meta.kind` `weekly_review`, so the weekly review is created once per user per week even when two runs overlap (the loser gets a duplicate-key error and sends nothing). The index builds on first connect; no existing rows have that kind.

## ledger_blocks

Append-only hash-linked log for finance data.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | ref: User |
| `sequence` | Number | unique per user |
| `scope` | String | finance collection scope |
| `entityId` | String | original record id |
| `action` | String | `import\|create\|update\|delete\|restore\|system` |
| `before` | Mixed | normalized previous state |
| `after` | Mixed | normalized next state |
| `previousHash` | String | prior block hash |
| `hash` | String | SHA-256 block hash |
| `idempotencyKey` | String | used for safe backfill |

## log_security

Stores encrypted authenticator secrets and hashed recovery codes for `/logs`.

## log_unlock_sessions

Short-lived TOTP unlocks tied to the active JWT session id and a tab-scoped device unlock id.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | ref: User |
| `sessionJti` | String | active NextAuth JWT id |
| `deviceHash` | String | hash of tab-scoped unlock id |
| `userAgentHash` | String | browser user-agent hash |
| `expiresAt` | Date | TTL; logs relock after expiry |

## captured_messages

Every bank message received from the phone (SMS / notification) or n8n. Nothing expires. Rules: [reconcile.md](reconcile.md). Replaces the old `sms_review_items` (30-day TTL); migrate with `yarn migrate:captures`.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `channel` | String | `sms\|notification\|n8n` |
| `apiKey` | ObjectId | ref: ApiKey, which caller sent it |
| `sender` / `packageName` | String | DLT sender id, or the bank app |
| `rawText` | `{iv, tag, ciphertext}` | AES-256-GCM with `CAPTURE_ENCRYPTION_KEY` |
| `receivedAt` | Date | |
| `contentHash` | String | sha256 of normalized text, permanent dedupe key |
| `alsoSeenIn` | [String] | channels the phone merged into this upload |
| `parse` | Object | `{kind, parserId, version, confidence, fields}` |
| `eventKey` | Object | `{account, type, amount, ref, at, hasTime}` for cross-channel matching |
| `sourcePriority` | Number | sms 3, n8n 2, notification 1 |
| `accountMatch` | String | `digits` or `bank`: how the account was picked (see docs/reconcile.md) |
| `suggestedAccount` | ObjectId | ref: Account, likely account for an unmatched message |
| `role` | String | `primary\|supporting` |
| `outcome` | String | `processing\|created\|queued\|pending_sms\|duplicate\|ignored` |
| `reason` | String | why queued/ignored |
| `status` | String | `pending\|resolved\|discarded` |
| `transaction` / `repayment` / `duplicateOf` | ObjectId | links |

Indexes: unique `{user, contentHash}`, `{user, status, createdAt}`, `{user, eventKey.amount, eventKey.type, eventKey.at}`, `{outcome, receivedAt}`, `{user, transaction}`

## transaction_corrections

Permanent record of each fix to an auto-captured transaction. Insert-only.

| Field | Type | Notes |
|-------|------|-------|
| `user`, `transaction`, `capturedMessage` | ObjectId | |
| `before` / `after` | Object | `{amount, type, account, category, date, description}`; `after` null when voided |
| `changedFields` | [String] | |
| `reason` | String | `wrong_amount\|wrong_type\|wrong_account\|wrong_date\|wrong_category\|wrong_merchant\|duplicate\|not_a_transaction\|other\|sms_override\|kept_user_values` |
| `note` | String | max 500 |
| `via` | String | `web\|mobile\|system` |
| `correctedBy` | ObjectId | null for system |
| `balanceEffects` | [{account, delta}] | |
| `ledgerSequence` | Number | matching ledger block |

Indexes: `{user, transaction, createdAt}`, `{user, createdAt}`

## api_keys

Bearer keys for `/api/integrations/*`, managed at Settings › API keys.

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | the key acts as this user |
| `label` | String | |
| `keyHash` | String | sha256 of the raw key, unique |
| `lastFour` | String | display only |
| `revoked` / `revokedAt` | Boolean / Date | revoked keys are kept |
| `expiresAt` | Date | null = never |
| `lastUsedAt` / `lastUsedIp` | Date / String | |
| `createdVia` | String | `web\|cli` |

Index: `{user, revoked}`

## idempotency_records

| Field | Type | Notes |
|-------|------|-------|
| `userId` | String | |
| `endpoint` / `key` | String | unique together with `userId` |
| `fingerprint` | String | sha256 of the request body |
| `status` | String | `pending\|completed` |
| `responseStatus` / `responseBody` | | replayed on retry |
| `expiresAt` | Date | TTL, `N8N_IDEMPOTENCY_TTL_SECONDS`; a pending record of a long write (CSV import) expires after 2 minutes until it completes |

## import_locks

One live CSV import per user and account.

| Field | Type | Notes |
|-------|------|-------|
| `user` / `account` | String | unique together: the lock |
| `expiresAt` | Date | TTL, 2 minutes, frees a lock if the run was killed |

## exchange_rates

One cached rate table per base currency (open.er-api.com), refreshed after 24 hours by `src/lib/exchange-rate-service.ts`; rows are kept so an outage can fall back to the last table for up to 30 days.

| Field | Type | Notes |
|-------|------|-------|
| `base` | String | unique; ISO 4217 |
| `rates` | Object | code to units of that currency per 1 unit of `base` (supported codes only) |
| `rateDate` | Date | the provider's own update time |
| `fetchedAt` | Date | when we fetched it |
| `lastAttemptAt` | Date | set when a refresh failed; no new attempt for 10 minutes (a row can exist with no table yet) |

## credit_statements

| Field | Type | Notes |
|-------|------|-------|
| `user`, `account` | ObjectId | |
| `periodStart` / `periodEnd` / `dueDate` | Date | unique `{account, periodStart}` |
| `status` | String | `open\|closed\|paid\|overdue` |
| `isPaid` / `paidAmount` / `paidAt` | | |
| `paymentTransactionId` | ObjectId | locks that transaction from edits |
| `isDeleted` / `deletedAt` / `deletedBy` | | soft delete |

## pushSubscriptions

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `endpoint` | String | unique |
| `keys.p256dh` | String | |
| `keys.auth` | String | |
| `isActive` | Boolean | set false on 410 |

## Backup files

No collection. A backup is built from the user's rows (accounts, transactions, budgets, goals, loans, repayments, rules, sinking funds, manual assets, subscription decisions, spend limit) and returned to the caller as an encrypted file; a restore inserts rows with the caller as `user`. Format and rules: [backup.md](backup.md).
