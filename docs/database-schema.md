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
| `preferences.currency` | String | ISO 4217 |
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
| `currency` | String | ISO 4217 |
| `color` | String | hex |
| `icon` | String | |
| `isArchived` | Boolean | soft delete |
| `deletedAt` / `deletedBy` | Date / ObjectId | set with `isArchived` |
| `creditMeta` | Object | credit cards only: `creditLimit`, `billingCycleDay`, `paymentDueDay`, `apr`, `network`, `lastFourDigits`, `cardholderName`, `minPaymentPct` |
| `smsLastFour` | [String] | 4-digit strings as shown in bank SMS (`A/c XX1234`), for matching captured messages |

Indexes: `{user, isArchived, createdAt}`, `{user, type}`, `{user, smsLastFour}`, `{user, creditMeta.lastFourDigits}`

## transactions

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | ref: User |
| `account` | ObjectId | ref: Account |
| `type` | String | `income\|expense\|transfer` |
| `amount` | Number | cents, always positive |
| `currency` | String | |
| `category` | String | |
| `subcategory` | String | |
| `description` | String | full-text indexed |
| `note` | String | full-text indexed |
| `date` | Date | |
| `tags` | [String] | |
| `transferTo` | ObjectId | ref: Account, only for transfers |
| `isRecurring` | Boolean | |
| `recurringId`, `recurrence*`, `installmentIndex`, `installmentStatus`, `paidAt` | | recurring series fields |
| `splitGroupId` | ObjectId | shared by split-purchase siblings |
| `source` | String | `manual\|sms\|notification\|n8n\|recurring\|import`, default `manual` |
| `sourceCapture` | ObjectId | ref: CapturedMessage, the message whose values are in use |
| `captures` | [ObjectId] | every captured message for this payment |
| `reviewStatus` | String | `unreviewed\|confirmed\|corrected\|voided`, null for manual rows |
| `reviewedAt` / `reviewedBy` | Date / ObjectId | |
| `isDeleted` | Boolean | soft delete |
| `deletedAt` | Date | |
| `deletedBy` | ObjectId | ref: User |

Indexes: `{user, isDeleted, date}` plus `{user, isDeleted, <account\|transferTo\|type\|category\|splitGroupId\|reviewStatus>, date}`, recurring-series indexes, `{user, tags}`, full-text on `{description, note}`

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
| `expiresAt` | Date | TTL, `N8N_IDEMPOTENCY_TTL_SECONDS` |

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
