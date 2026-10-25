# API: household
Purpose: the browser (session) twins of household sharing, used by the `/household` page: manage shares and read what an owner shares with you. The phone app uses `/api/integrations/shares` and `/api/integrations/shared/...`.

## Files
- shares/route.ts (GET `{owned, received}`, POST invite -> `{share, code}`), shares/[id]/route.ts (PATCH owner changes accounts, role or budgets; DELETE owner ends it or member leaves), shares/[id]/accept (POST `{code}`), decline (POST), code (POST a new invite code).
- shared/[ownerId]/accounts, transactions, summary (GET, read only; no budgets or editor write on the web).

## Talks to
- Libs: src/lib/share-service.ts (all rules), share-browser.ts (error JSON). Models: Share, Account, Transaction, User, Notification.
- UI: src/features/household. Mobile: planned (TVRCloud/expense-tracker-mobile#65).

## Rules and gotchas
- The proxy requires a session for `/api/household`; a shared read still goes through `loadActiveShare`, so a signed-in stranger gets 404.
- No `Idempotency-Key` on the browser routes (the integration routes need one). The invite code is returned once.
- Design and permission matrix: [docs/household.md](../../../docs/household.md); contract: [docs/api-contracts.md](../../../docs/api-contracts.md#household-sharing).

## Tests
- `src/test/household.test.ts` ("browser routes").

## Last changed
- feat(household): share accounts with a partner, viewer or editor
