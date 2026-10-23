# ADR-0005: Hash-chained ledger behind a TOTP-gated Logs page

Status: Accepted
Date: 2026-06-09

## Context
Finance data changes (create, update, delete, restore) needed a record that shows tampering. Commit 05ee84b "Added blockchain and logs" introduced it on branch `3-block-chain-concept-and-logs-tracking`. The repo records no further rationale, so only the mechanism is recorded here.

## Decision
- Every finance write appends a block to `ledger_blocks`: per-user `sequence`, `scope`, `entityId`, `action`, normalized `before` and `after`, `previousHash` and SHA-256 `hash`. The first block links to a genesis hash of 64 zeros.
- `GET /api/logs/ledger/verify` re-checks the chain. `ensureLedgerBackfill` exists to bring earlier records into the chain.
- The Logs page is locked behind TOTP (authenticator plus recovery codes). Unlock lasts 5 minutes per session and device; the ledger routes answer 423 when locked.
- TOTP secrets are encrypted at rest with `TOTP_ENCRYPTION_KEY`.

## Consequences
- Every write path must call `appendLedgerBlock`; a missed call leaves no record.
- Concurrent appends race on the unique {user, sequence} index and retry (up to 25 times with backoff).
- The chain is tamper-evident inside the same database, not external proof.
- Reconcile corrections also store the ledger sequence they produced.

## Source
`src/lib/ledger.ts`, `src/lib/log-security.ts`, `docs/database-schema.md` (`ledger_blocks`); commits 05ee84b and b4bece0 "#patch security".
