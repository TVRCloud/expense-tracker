# ADR-0003: Per-caller API keys for the integration API

Status: Accepted
Date: 2026-09-05 onward (n8n work), 2026-10-16 (hash note)

## Context
`src/models/ApiKey.ts` records that the first scheme was one env var pair (`N8N_API_KEY` plus `N8N_USER_EMAIL`). n8n and the phone app both need access, and losing a phone or rotating one caller should not break the other. `docs/n8n-integration.md` notes the old env vars are no longer read.

## Decision
- Integration routes under `/api/integrations/*` authenticate with `Authorization: Bearer etk_...`, looked up in the `api_keys` collection. Each key belongs to one user and acts only as them.
- Only the SHA-256 hash is stored; the raw key is shown once. Plain SHA-256 is intentional: keys are 256-bit random server-generated tokens, not passwords (commit 0c23e17, after a CodeQL `js/insufficient-password-hash` flag).
- Minting needs the password again, is rate limited, and is capped at 10 live keys per user. Keys are revoked or expire, never deleted.
- Rate limits count per key. Auth failures are limited per IP.
- These routes use their own response envelope (`{success, data | error, requestId}`) so workflows can branch on stable error codes.

## Consequences
- `src/proxy.ts` exempts `/api/integrations`; the key is the only gate there.
- Verified keys are cached 30s per instance, so a revoke on another instance can take up to 30s to apply.
- Two response conventions exist in the app: the browser's `{data}` / `{error}` and the integration envelope.

## Source
`src/models/ApiKey.ts`, `src/lib/integrations/auth.ts`, `src/lib/integrations/api-keys.ts` and `response.ts` comments; `docs/n8n-integration.md`; commits 0c23e17 and 0ed47fb.
