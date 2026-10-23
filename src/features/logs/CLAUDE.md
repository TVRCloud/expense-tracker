# Logs
Purpose: OTP-protected view of the tamper-evident ledger (hash chain of every change). Page spec: [docs/pages/09-logs.md](../../../docs/pages/09-logs.md).

## Files
- components/LogsClient.tsx: `/logs` screen: authenticator setup, unlock, ledger list, chain verify, rotate and recovery codes.

## Talks to
- `GET /api/logs/ledger`, `GET /api/logs/ledger/verify`, `/api/logs/otp/{status,setup,verify,lock,disable,rotate/start,rotate/confirm,recovery/regenerate}`.
- Models: LedgerBlock, LogSecurity, LogUnlockSession, User. Server: src/lib/log-security.ts, src/lib/ledger.ts.
- Mobile: none.

## Rules and gotchas
- Ledger routes answer 423 "Logs are locked" unless the session and device are unlocked. Every call sends the `x-logs-device-id` header (`logsHeaders` in LogsClient).
- Unlock lasts 5 minutes (`LOG_UNLOCK_MINUTES`).
- Sensitive OTP actions are limited to 5 per 10 minutes per user and IP.
- TOTP secrets are encrypted with `TOTP_ENCRYPTION_KEY` (32+ chars).

## Tests
- None.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
