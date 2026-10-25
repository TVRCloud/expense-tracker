# Net worth
Purpose: one number for what the user owns minus what they owe, with the rows behind it, a daily trend, and the manual assets (property, gold) that count toward it.

## Files
- components/NetWorthClient.tsx: `/net-worth` page: figure and change, range tabs, trend chart (recharts area), Owned and Owed rows, and the "Other things you own" list with an add form and remove.
- hooks/useNetWorth.ts: `useNetWorth(range)` (key `["net-worth", range]`), `useManualAssets()` (key `["net-worth", "assets"]`), `useAddManualAsset()`, `useRemoveManualAsset()`.

## Talks to
- `GET /api/net-worth`, `GET POST /api/net-worth/assets`, `DELETE /api/net-worth/assets/:id`.
- Libs: src/lib/net-worth.ts. Models: ManualAsset, NetWorthSnapshot. Cron: `/api/cron/net-worth-snapshot`.
- Mobile: none yet; the app will read `integrations/net-worth` (TVRCloud/expense-tracker-mobile#54).

## Rules and gotchas
- Amounts are cents, shown with `useCurrency().formatCurrency`.
- Reading net worth stores today's point, so the trend always ends today.
- Realtime resource `netWorth` (manual assets) plus `transactions`, `accounts`, `loans`, `repayments`, `holdings` invalidate the `["net-worth"]` keys.
- Holdings (investments page) count as one Owned row `holdings`; an `investment` account and a manual asset of kind `investment` are counted on their own, so the same money must not be entered as both.
- The trend is stored daily points, so a new holding or manual asset shows its whole value as gain over 30d/90d/1y until older points age out.
- The Analytics page has its own older chart (`NetWorthTrendChart`) rebuilt from monthly totals; it does not use this data.

## Tests
- `src/test/integrations.test.ts` ("net worth").

## Last changed
- feat: holdings count in net worth
- feat(integrations): net worth with a daily trend and manual assets
