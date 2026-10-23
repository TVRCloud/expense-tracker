# Recurring
Purpose: recurring transaction series (salary, EMIs, subscriptions) and their upcoming installments. Covered in [docs/pages/02-transactions.md](../../../docs/pages/02-transactions.md).

## Files
- components/RecurringSeriesListClient.tsx: `/transactions/recurring` list.
- components/RecurringSeriesClient.tsx: `/transactions/recurring/[recurringId]` detail, mark installments.
- components/UpcomingPaymentsWidget.tsx: dashboard widget.
- hooks/useRecurringSeries.ts: keys `["recurring-series"]`, `["recurring-series-detail"]`, `["upcoming-installments"]`.

## Talks to
- `GET /api/transactions/recurring` (`?upcoming=`), `GET/DELETE /api/transactions/recurring/:recurringId`, `PATCH .../installments/:id`.
- Models: Transaction. Cron: `GET /api/cron/recurring-topup`.
- Mobile: `PATCH /api/integrations/transactions/recurring/:recurringId/installments/:id` exists for API callers.

## Rules and gotchas
- Open-ended series keep only `OPEN_ENDED_WINDOW` upcoming rows; src/lib/recurring-topup.ts refills them (server.ts every 6h, Vercel cron daily at 03:00).
- Only installments marked paid affect balances and stats.
- Deleting a series stops the top-up and recomputes the account balance.

## Tests
- None in this dir.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
