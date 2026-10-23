# Dashboard
Purpose: home screen after login: net worth, month income and spend, account cards, recent transactions. Page spec: [docs/pages/01-dashboard.md](../../../docs/pages/01-dashboard.md).

## Files
- components/DashboardClient.tsx: the screen, including its empty state.
- components/WalletCard.tsx, StatCard.tsx, SpendCard.tsx: account card and stat tiles.
- hooks/useDashboard.ts: queries `["transactions","stats",m,y]`, `["transactions","recent",n]`, `["accounts"]`.

## Talks to
- `GET /api/transactions/stats`, `GET /api/transactions`, `GET /api/accounts`; also `GET /api/me` via settings' useProfile.
- Models: Transaction, Account, User.
- Mobile: Home (lib/features/home), fed by `GET /api/integrations/home`.

## Rules and gotchas
- `src/app/(app)/dashboard/page.tsx` prefetches these queries on the server and hydrates them. Query keys must stay identical to the hooks' keys or the prefetch is wasted.
- Page is `force-dynamic` (per-user data).
- Credit summary and upcoming-payments widgets come from the credit-cards and recurring features.

## Tests
- None in this dir. Home read paths: `src/test/integrations.test.ts` (home read paths).

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
