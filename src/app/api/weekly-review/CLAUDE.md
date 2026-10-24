# API: weekly-review
Purpose: browser read of the weekly review (a look back at one Monday to Sunday week).

## Files
- route.ts: GET `?week=YYYY-MM-DD`.

## Talks to
- Libs: weekly-review (`getWeeklyReview`, `WeeklyReviewError`).
- Models: Transaction, Budget, SpendLimit, User (read through the lib).
- UI: none yet. Mobile: `integrations/weekly-review` (same lib, API-key auth).

## Rules and gotchas
- All the logic is in src/lib/weekly-review.ts; this route and `integrations/weekly-review` both call it.
- Session auth only (`requireAuth`); errors use the browser's `{error}` shape, 400 for a bad or future week.
- The notification settings and the cron hook are not here: `integrations/weekly-review/settings` and `cron/weekly-review`.

## Tests
- `weekly review` in `src/test/integrations.test.ts`.

## Last changed
- #80: weekly review
