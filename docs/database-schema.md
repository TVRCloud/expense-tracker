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

Indexes: `{user, isArchived}`, `{user, type}`

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
| `isDeleted` | Boolean | soft delete |
| `deletedAt` | Date | |
| `deletedBy` | ObjectId | ref: User |

Indexes: `{user, date}`, `{user, account}`, `{user, type}`, `{user, category}`, full-text on `{description, note}`

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
| `targetDate` | Date | |
| `linkedAccount` | ObjectId | ref: Account |
| `icon` | String | |
| `color` | String | |
| `isCompleted` | Boolean | |

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

## pushSubscriptions

| Field | Type | Notes |
|-------|------|-------|
| `user` | ObjectId | |
| `endpoint` | String | unique |
| `keys.p256dh` | String | |
| `keys.auth` | String | |
| `isActive` | Boolean | set false on 410 |
