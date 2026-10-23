# ADR-0004: MongoDB-backed idempotency for integration writes

Status: Accepted
Date: 2026-09 (n8n work)

## Context
n8n and the phone app retry requests after timeouts. A retry must not create a second transaction. The codebase uses no mongoose sessions or distributed locks (`src/lib/integrations/idempotency.ts` comments), and Vercel instances share no memory.

## Decision
- Mutating integration calls require an `Idempotency-Key` header, scoped per user and endpoint.
- Store a record in `idempotency_records` with a request-body fingerprint. A unique index on (userId, endpoint, key) is the only concurrency guard.
- Same key and same body replays the stored response. Same key and a different body returns 409 `IDEMPOTENCY_CONFLICT`. A concurrent duplicate loses its insert (E11000) and also gets 409 "in progress", so callers retry shortly.
- Records expire after `N8N_IDEMPOTENCY_TTL_SECONDS` (default 24h) through a TTL index.
- Bank message capture does not use this cache; it dedupes on the permanent content hash (ADR-0002).

## Consequences
- No blocking or polling for the winner; the loser must retry.
- The fingerprint sorts top-level keys only, which is enough for the flat payloads in use.
- The phone app sends one key per user action and body so a retry applies once.

## Source
`src/lib/integrations/idempotency.ts`, `src/models/IdempotencyRecord.ts`, `docs/n8n-integration.md` "Idempotency"; mobile `docs/architecture.md` (Idempotency-Key per action).
