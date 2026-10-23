# API: me
Purpose: the signed-in user's profile, password, preferences, export and API keys.

## Files
- route.ts: get and patch profile; `DELETE` soft-deletes the account.
- password/route.ts, preferences/route.ts (includes `timezone`, an IANA zone checked with `isValidTimeZone`), export/route.ts (JSON file download).
- api-keys/route.ts: list and mint keys. api-keys/[id]/route.ts: revoke.

## Talks to
- Libs: integrations/api-keys and auth, perf/session-cache, security-rate-limit, log-security.
- Models: User, ApiKey, Session, Account, Transaction, Budget, Goal, Loan, Repayment.
- UI: src/features/settings. Mobile: Connect screen uses a minted key.

## Rules and gotchas
- Minting a key needs the password again, is rate limited, returns the raw key once with `Cache-Control: no-store`, and keys are never deleted (revoked and expired stay listed).
- `DELETE /api/me`: reuses `isActive`, rewrites email to a tombstone, ends all sessions.
- Password change and delete clear cached sessions (`forgetUserSessions`) so they apply at once.
- Docs: [docs/n8n-integration.md](../../../../docs/n8n-integration.md).

## Tests
- `src/test/integrations.test.ts` (`/api/me/api-keys`).

## Last changed
- 0ed47fb perf: cut round trips and full scans on home-screen reads
