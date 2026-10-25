# API: me
Purpose: the signed-in user's profile, password, preferences, export and API keys.

## Files
- route.ts: get and patch profile; `DELETE` soft-deletes the account, ends every household share the person owns or belongs to (`revokeAllSharesOfUser`, before locking and once more last) and, before and after locking it, purges every private receipt image of the user (`deleteAllReceiptsOfUser`, src/lib/receipt-service.ts: the first purge failing fails the request so it can be retried, the last one only logs).
- password/route.ts, preferences/route.ts (includes `timezone`, an IANA zone checked with `isValidTimeZone`, and `currency`, the base currency), export/route.ts (JSON file download; includes receipt metadata only: id, transaction, content type, size, date. The images are encrypted with the server key and are not exported).
- api-keys/route.ts: list and mint keys. api-keys/[id]/route.ts: revoke.

## Talks to
- Libs: integrations/api-keys and auth, perf/session-cache, security-rate-limit, log-security.
- Libs also: base-currency and currency (preferences `currency`), receipt-service (purge on delete), share-service (end shares on delete).
- Models: User, ApiKey, Session, Account, Transaction, Budget, Goal, Loan, Repayment, Receipt.
- UI: src/features/settings. Mobile: Connect screen uses a minted key.

## Rules and gotchas
- Minting a key needs the password again, is rate limited, returns the raw key once with `Cache-Control: no-store`, and keys are never deleted (revoked and expired stay listed).
- `DELETE /api/me`: reuses `isActive`, rewrites email to a tombstone, ends all sessions, withdraws and deletes the user's bank link consents first (`deleteAaDataForUser`); a consent that cannot be withdrawn keeps its record and the delete answers 409.
- `PATCH /api/me/preferences` `currency` is the base currency: it must be a supported code and goes through `setBaseCurrency`, so it is refused (400, `code` `UNSUPPORTED_BASE_CURRENCY` for a currency without two decimals, `HAS_MONEY_DATA` once the user has transactions, balances, budgets, goals, loans, funds, assets, holdings, envelope plans or a spend limit). Saving the unchanged currency still works, and the other preference fields save as before.
- Password change and delete clear cached sessions (`forgetUserSessions`) so they apply at once.
- Docs: [docs/n8n-integration.md](../../../../docs/n8n-integration.md).

## Tests
- `src/test/integrations.test.ts` (`/api/me/api-keys`).

## Last changed
- cbdb35f fix(currency): only allow base currencies with two decimals for now
