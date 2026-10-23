# API: logs
Purpose: read and verify the ledger, behind a TOTP unlock.

## Files
- ledger/route.ts: paged ledger blocks (`skip`, `limit` max 100, `scope`, `entityId`).
- ledger/verify/route.ts: re-checks the hash chain.
- otp/*: status, setup, verify, lock, disable, rotate start and confirm, recovery codes.

## Talks to
- Libs: log-security (TOTP), log-auth-request (device header, rate limit), ledger.
- Models: LedgerBlock, LogSecurity, LogUnlockSession, User.
- UI: src/features/logs. Mobile: none.

## Rules and gotchas
- Ledger reads need `isLogsUnlocked(userId, jti, deviceId, userAgent)`; otherwise 423.
- Device id comes from header `x-logs-device-id`. Unlock lasts 5 minutes.
- `enforceSensitiveActionLimit`: 5 attempts per 10 minutes per user and IP, on sensitive OTP actions.
- Chain format and writers: src/lib/ledger.ts (see src/lib/CLAUDE.md).

## Tests
- None.

## Last changed
- b4bece0 #patch security
