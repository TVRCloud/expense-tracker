# Accounts
Purpose: list, create, edit, archive and view money accounts (bank, cash, credit card and so on). Page spec: [docs/pages/03-accounts.md](../../../docs/pages/03-accounts.md).

## Files
- components/AccountsClient.tsx: `/accounts` list, create form, per-card EMI commitment map.
- components/AccountDetailClient.tsx: `/accounts/[id]`; hands credit cards to the credit-cards feature's detail view.
- schemas/account.schema.ts: zod create schema, shared by the form and the API route. `currency` must be a supported ISO code (`isSupportedCurrency`); `balance` is within plus or minus `MAX_MINOR_AMOUNT` (1e13) and `creditMeta.creditLimit` is capped at it too.

## Talks to
- `GET/POST /api/accounts`, `GET/PATCH/DELETE /api/accounts/:id` (src/app/api/accounts).
- Models: Account, Transaction. Query key `["accounts"]`, refreshed by SSE `accounts`.
- Mobile: `GET /api/integrations/accounts` feeds the app's home account cards (lib/features/home).

## Rules and gotchas
- DELETE archives (`isArchived`, `deletedAt`, `deletedBy`); it never removes the row. Unarchive is `PATCH { isArchived: false }`.
- `smsLastFour` ("SMS match digits") is what capture matching reads: see [docs/reconcile.md](../../../docs/reconcile.md).
- Balance rewrites (`POST /api/accounts/:id/recalculate`) count only paid recurring installments.
- Money is integer cents ([docs/database-schema.md](../../../docs/database-schema.md)).
- An account's `currency` is only a label; balances are in the user's base currency, so show amounts in the base (`useCurrency`), not the account's label. Creating an account with a nonzero balance or a credit limit locks the base currency (src/lib/account-service.ts).

## Tests
- None in this dir. Account matching is covered in `src/test/integrations.test.ts`.

## Last changed
- c1992c7 fix(currency): lock the base currency atomically, convert bank messages, exact rounding, bounded client rates
