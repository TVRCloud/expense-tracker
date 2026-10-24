# API: credit-cards
Purpose: credit-card summary, billing-cycle statements and reward rules with the estimate they earn.

## Files
- Both GET routes are thin wrappers over src/lib/credit-card-service.ts, also used by `integrations/credit-cards/*`.
- summary/route.ts: per-card balances, utilization, due state for all cards; Redis cached 60s.
- [accountId]/statements/route.ts: current open cycle plus past 12 cycles; lazily creates statement records.
- [accountId]/statements/[statementId]/route.ts: `PATCH` to update a statement and pay it. `paidAmount` is capped at `MAX_MINOR_AMOUNT` (1e13). Paying from a source account moves base-unit balances, so it calls `lockBaseCurrency` before writing and books the payment transfer in the base currency (not the card's `currency` label).
- rewards/route.ts: `GET` every card with its rule and current-cycle estimate. [accountId]/rewards/route.ts: `GET` (estimate per billing cycle, `cycles` 1 to 12), `PUT` replaces the reward rule, `DELETE` removes it. Both call src/lib/card-rewards-service.ts, also used by `integrations/credit-cards/**/rewards`.

## Talks to
- Libs: credit-card (cycle maths), credit-balance, credit-notifications, ledger, perf/background, redis.
- Libs also: base-currency (lock before a payment writes), currency (amount cap).
- Models: Account, CreditStatement, Transaction.
- UI: src/features/credit-cards. Mobile: reads the same data through `integrations/credit-cards/*`.

## Rules and gotchas
- Cycle dates and balances come from src/lib/credit-card.ts and credit-balance.ts; do not recompute in routes.
- Cards are `Account` rows with `creditMeta` (billing day, limit, last four digits). An account's `currency` is only a label: every amount here is in the user's base currency (`getBaseCurrency`).
- Notification checks run after the response via `runInBackground`.
- Short TTL cache instead of invalidate-on-write, same convention as stats-service.
- Schema: [docs/database-schema.md](../../../../docs/database-schema.md).

## Tests
- None specific.

## Last changed
- cddbc26 fix(currency): keep capture matching in rupees, lock the base only when a write goes through, fix transfer and idempotency errors
