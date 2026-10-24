# API: cron
Purpose: scheduler hooks for jobs that also run from server.ts.

## Files
- promote-captures/route.ts: turns held notifications whose SMS never came into transactions.
- recurring-topup/route.ts: refills open-ended recurring series.
- bill-reminders/route.ts: reminders for bills inside each opted-in user's lead time, from 09:00 on their clock, once per bill per due date.
- net-worth-snapshot/route.ts: stores today's net worth point for every active user (every 3 hours from server.ts; last write of the day wins).
- spend-limit-summary/route.ts: end-of-day spend limit notice, once per user per local day from 21:00 in their time zone.

## Talks to
- Libs: cron-auth, net-worth (`recordSnapshotsForAllUsers`), spend-limit (`sendSpendLimitSummaries`), bill-reminders (`sendBillReminders`), capture/ingest (`promoteStalePendingSms`), recurring-topup, reminder-scheduler.
- Schedulers: `vercel.json` runs recurring-topup daily at 03:00; promote-captures, spend-limit-summary and bill-reminders need an external scheduler on Vercel (see [docs/reconcile.md](../../../../docs/reconcile.md) Setup; call spend-limit-summary and bill-reminders every 30 minutes and net-worth-snapshot every few hours).

## Rules and gotchas
- Auth is `Authorization: Bearer $CRON_SECRET` checked by `isAuthorizedCron` (hashed, timing safe). Not a session route.
- `src/proxy.ts` exempts `/api/cron`.
- server.ts runs the same jobs on timers; routes exist because Vercel has no such timer.

## Tests
- None specific.

## Last changed
- e08c36f app support
