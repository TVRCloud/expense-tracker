# Account Aggregator (bank link)

Pull bank transactions through India's consent-based Account Aggregator (AA) system, as a second source next to SMS. Code: `src/lib/aa-service.ts`, `src/lib/aa/*` (provider seam and the sandbox), `ingestAaTransaction` in `src/lib/capture/ingest.ts`, routes under `src/app/api/integrations/aa` and `src/app/api/cron/aa-sync`. Tests: `src/test/aa.test.ts`.

## Status: the framework only, not live

A live AA integration needs things that do not exist yet (see "Going live"). What ships is the provider-agnostic framework and one deterministic `sandbox` provider:

- `AA_PROVIDER` unset (the default): `GET /api/integrations/aa` answers `{configured: false, provider: null, consents: []}` and every other AA endpoint answers `503 AA_NOT_CONFIGURED`. The cron route and the timer do nothing. Nothing else in the app changes.
- `AA_PROVIDER=sandbox`: a fake provider kept in process memory. It never talks to a network and loses everything on restart. Its default feed is two bank accounts (HDFC `1234`, Axis `9876`) with four rupee transactions placed in the days before the consent was made. Use it for demos and tests only; it is not for production.

## How it works

1. **Start.** `POST /aa/consents` asks the provider to create a consent for an opaque, stable id of the person (a hash, never the email). The answer carries the consent and, once, `redirectUrl`: the address of the provider's consent screen, where the person approves. The idempotency record keeps the consent but not the address, so a retried request answers `redirectUrl: null`; start a new link instead.
2. **Approve.** The person approves at the provider. There is no inbound callback (so no callback to forge); the app calls `POST /aa/consents/:id/refresh`, which asks the provider for the status and fills in the linked bank accounts. A new linked account is mapped to one of the user's own accounts when its last four digits and bank point at exactly one (the same matcher SMS uses). `PATCH /aa/consents/:id/accounts/:linkedId` sets or clears a mapping. **A linked account that is not mapped is never read**, and one of the user's accounts is fed by one linked account only (two feeds into one would book each payment twice).
3. **Sync.** Every active consent is read by the cron route `/api/cron/aa-sync` (every 6 hours from `server.ts`; at most hourly per consent) and on demand by `POST /aa/consents/:id/sync` (refused with 429 for 5 minutes after the last read). A run is bounded: 10 pages of 100, 1,000 transactions and 20 seconds; if it stops at a limit it resumes exactly there next time (`syncedPartial`), otherwise the next run starts 2 days before the last one ended so late entries are caught (repeats are no-ops). One sweep at a time per process, and a sweep older than 10 minutes counts as hung. The first read goes back 90 days.
4. **Into the ledger.** Each provider transaction becomes a `captured_messages` row with channel `aa` and goes through the same path as an SMS (`docs/reconcile.md`): the `contentHash` is a hash of `aa:provider:transactionId`, so the same transaction can never be stored twice (a re-sync is idempotent by the existing unique index); the rest is matched against other captures and against rows entered by hand, then turned into a transaction through `createTransaction` (base currency lock, categorise rules, realtime and the ledger chain all apply as for any write).
5. **End.** `POST /aa/consents/:id/revoke` tells the provider, marks the consent `revoked`, stops syncing and keeps every transaction already added. `providerRevoked: false` means the provider did not confirm, and the person may need to withdraw it at their bank too. Expiry and a withdrawal at the provider are noticed during sync or refresh: the status changes once and one notification is written. Deleting the account withdraws every consent (best effort) and removes the records.

## Balances

The stored balance of an account is the figure the user maintains, not something recomputed from the ledger. So a bank entry **older than the link** (made before the consent was created) is written as history: it appears in lists and statistics, but changes no balance and fires no budget, spend limit or round-up alert, whether it is created automatically or confirmed later from the review inbox (the capture keeps a `historical` flag for that). Entries from the link date on move the balance like any capture. In the link flow, ask the user to **set the account balance to match the bank at the moment they link it**; the feed never corrects it.

## Dedupe

- **Against SMS, n8n and notification captures:** the existing cross-channel rules apply. The AA feed has priority 2 (SMS 3, n8n 2, notification 1). An SMS outranks it: if the SMS arrived first, the bank entry is recorded as a supporting message and changes nothing; if the bank entry came first, a later SMS replaces its values as a normal `sms_override`. A notification-sourced row is corrected by the bank entry. A payment that may be the same one but cannot be proven (account unknown on one side, no common bank reference) is queued for review as `possible_duplicate`, never guessed.
- **Against rows entered by hand and imported rows:** a bank entry claims one existing row with the same account, type, amount and day on the user's clock that is not yet tied to any captured message (the closest in time). The row's own values are left as they are and the bank entry is recorded as its supporting message. One bank entry claims one row, so two equal manual rows are kept for two bank entries. Where a different real payment has the same account, amount and day as a manual row, it will be treated as that row: an accepted trade-off against double entry.
- **History** (older than the link was made) is written with no balance change and no budget, spend limit or round-up alerts, like a CSV import; new activity moves balances like any capture. AA-created rows are not put in the review inbox (`reviewStatus` null). Categorise rules apply. A feed in a currency other than INR is skipped and counted (`skippedCurrency`); with another base currency the rupee amount is converted as for SMS.

## Rules the sync keeps

- One of your accounts is fed by one live bank link only: mapping (by hand or automatically) is refused when another pending, active or paused consent of yours already feeds it, across consents as well as within one. Archiving an account clears every mapping that points at it, and a sync skips a mapping whose account was archived another way.
- Everything a provider returns is validated at the boundary (`src/lib/aa/provider.ts`, zod): the consent screen address must be https, the status one of the six, and each transaction needs an id of at most 200 characters, a valid date, an integer amount of at least 1 and within the app's maximum, and a type. A bad answer is a provider error; a bad transaction is skipped and counted in `skippedInvalid`.
- Skipped entries (another currency, invalid) still move the resume point, so a long run of them cannot stall a link.
- A read counts toward the 5 minute cooldown and the hourly interval even when it fails; a read that starts while another is running answers 429.
- A captured message a crash left in `processing` for 5 minutes is finished by the next read of the same entry (one reader wins the claim); if the crash came after the transaction was written, that transaction is reused, never booked twice. Entries a provider returns for a different linked account than the one asked are skipped.
- The consent cap is settled after the insert (the oldest live consents keep their place), so requests started at once cannot pass it.
- The sweep (`/api/cron/aa-sync` and the timer) stops starting consents after 240 seconds (the route's limit is 300) and says `partial: true`; the consents it did read have a fresh `lastSyncAt`, so the next run starts with the rest.
- Revoke and mapping, like start, answer `503 AA_NOT_CONFIGURED` while `AA_PROVIDER` is unset. The cron route stays a `200 {ok:true, checked:0, created:0}` in that case on purpose: a failing cron would only raise alarms for a feature that is switched off.

## Data stored

`aa_consents` (`src/models/AaConsent.ts`): user, provider name, the provider's handle for the consent (AES-GCM encrypted with `CAPTURE_ENCRYPTION_KEY`; a hash of it to find a consent without decrypting), status (`pending|active|paused|revoked|expired|failed`), expiry, the linked bank accounts (provider reference, bank name, **last four digits only**, the mapped account of the user, how far it has been read), last sync time and a short error code. Nothing else from the feed is kept apart from the ledger rows it becomes and one captured message per transaction (the text is a one-line summary and is encrypted like every captured message).

## Security

- The provider's handle is a secret: stored encrypted, never returned, never logged. Responses show the bank name and the last four digits only. Provider errors are logged as a short code, never the provider's message.
- Every query is scoped to the signed-in user; a consent id that is not yours is a 404 (and so is a malformed one). The handle is checked by the provider on every call.
- All writes carry an `Idempotency-Key` (start, revoke, mapping); refresh and sync are safe to repeat. The route group `aa` is rate limited, and sync has a cooldown, page, count and time limits.
- Consents are **not** in backups (they are secrets bound to a provider session; restore them by linking again).
- The redirect address is returned once and is not stored by the idempotency record. It carries no data access: approval needs the person's own login and one-time code at the bank or provider.

## Going live

None of this exists yet, and each is needed before AA_PROVIDER can name a real provider:

1. A licensed FIU (or a TSP acting for one) agreement, and onboarding to the RBI Account Aggregator ecosystem. Without it no AA will release data.
2. A provider (for example Finvu, OneMoney or CAMS Finserv) with sandbox and production credentials, and its signing keys and callback or polling terms.
3. Legal review of the consent purpose, data retention and what the app tells the user, and a privacy notice.
4. A provider file in `src/lib/aa/` that implements `AaProvider` (`createConsent`, `consentStatus`, `fetchTransactions`, `revoke`; the contract is in `src/lib/aa/provider.ts`: transactions oldest first, amounts positive in minor units, the provider's own transaction ids stable across fetches), registered by name in `src/lib/aa/providers.ts`. Its credentials go in env vars that only that file reads. Everything else (consents, mapping, sync, dedupe, revoke, expiry, realtime) is already in place.
5. Decide the production schedule: `GET /api/cron/aa-sync` with `Authorization: Bearer $CRON_SECRET` (see `docs/deployment.md`).

## API

See [api-contracts.md](api-contracts.md), "Account Aggregator". Errors use the integration envelope; `AA_NOT_CONFIGURED` is 503 and `AA_PROVIDER_ERROR` is 502.
