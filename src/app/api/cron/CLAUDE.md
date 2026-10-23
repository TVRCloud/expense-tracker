# API: cron
Purpose: scheduler hooks for jobs that also run from server.ts.

## Files
- promote-captures/route.ts: turns held notifications whose SMS never came into transactions.
- recurring-topup/route.ts: refills open-ended recurring series.

## Talks to
- Libs: cron-auth, capture/ingest (`promoteStalePendingSms`), recurring-topup, reminder-scheduler.
- Schedulers: `vercel.json` runs recurring-topup daily at 03:00; promote-captures needs an external scheduler (see [docs/reconcile.md](../../../../docs/reconcile.md) Setup).

## Rules and gotchas
- Auth is `Authorization: Bearer $CRON_SECRET` checked by `isAuthorizedCron` (hashed, timing safe). Not a session route.
- `src/proxy.ts` exempts `/api/cron`.
- server.ts runs the same jobs on timers; routes exist because Vercel has no such timer.

## Tests
- None specific.

## Last changed
- e08c36f app support
