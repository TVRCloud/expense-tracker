# API: credit-cards
Purpose: credit-card summary and billing-cycle statements.

## Files
- Both GET routes are thin wrappers over src/lib/credit-card-service.ts, also used by `integrations/credit-cards/*`.
- summary/route.ts: per-card balances, utilization, due state for all cards; Redis cached 60s.
- [accountId]/statements/route.ts: current open cycle plus past 12 cycles; lazily creates statement records.
- [accountId]/statements/[statementId]/route.ts: `PATCH` to update a statement and pay it.

## Talks to
- Libs: credit-card (cycle maths), credit-balance, credit-notifications, ledger, perf/background, redis.
- Models: Account, CreditStatement, Transaction.
- UI: src/features/credit-cards. Mobile: reads the same data through `integrations/credit-cards/*`.

## Rules and gotchas
- Cycle dates and balances come from src/lib/credit-card.ts and credit-balance.ts; do not recompute in routes.
- Cards are `Account` rows with `creditMeta` (billing day, limit, last four digits).
- Notification checks run after the response via `runInBackground`.
- Short TTL cache instead of invalidate-on-write, same convention as stats-service.
- Schema: [docs/database-schema.md](../../../../docs/database-schema.md).

## Tests
- None specific.

## Last changed
- a2b12d4 perf(web): server-render the dashboard's first data, paint at once
