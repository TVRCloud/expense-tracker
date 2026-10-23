# Analytics
Purpose: monthly and multi-month spending charts, category breakdown and history. Page spec: [docs/pages/07-analytics.md](../../../docs/pages/07-analytics.md).

## Files
- components/AnalyticsClient.tsx: `/analytics` screen; jumps to the latest month with data if the current one is empty.
- components/AnalyticsBarChart.tsx, CategoryRingGrid.tsx, IOCard.tsx, HistoryRow.tsx: chart and tile pieces.
- components/NetWorthTrendChart.tsx: rebuilt from data the app already fetches; no endpoint of its own.
- hooks/useAnalytics.ts: `useAnalytics` queries (keys `["transactions","stats",m,y]`, `["analytics","multimonth",...]`).

## Talks to
- `GET /api/transactions/stats?month&year`, `GET /api/transactions/stats/range?months=`.
- Models: Transaction (via src/lib/stats-service.ts; Redis cache).
- Mobile: none (the app reads `GET /api/integrations/summary`, same stats function).

## Rules and gotchas
- Recurring installments count only once marked paid; regular rows always count (stats/range route).
- Category colours come from src/lib/category-colors.ts, so a category looks the same everywhere.
- Cache keys are invalidated through the `transactions` realtime map: see [docs/realtime.md](../../../docs/realtime.md).

## Tests
- None in this dir.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
