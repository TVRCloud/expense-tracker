# Tax
Purpose: the financial year (April to March) summary for an accountant: income, spending, saved, deductible spending by category and a month by month strip, with the switches that decide what is deductible.

## Files
- components/TaxClient.tsx: `/tax` page: year picker, CSV download, Print, the figures with a 12 bar strip (spending, deductible part in green), deductible and income by category, and a switch for every spending category plus any saved one with no spend that year.
- hooks/useTax.ts: `useTaxSummary(fy)` (key `["tax", fy]`), `useChangeDeductibleCategories()` (sends `{add}` or `{remove}`, refetches on settle).

## Talks to
- `GET /api/tax?fy=`, `GET /api/tax/export?fy=` (a plain link), `PATCH /api/tax/settings`; `PATCH /api/tax/transactions/:id` exists for the app and has no web control yet.
- Libs: src/lib/tax-service.ts, tax-year.ts, tax-settings.ts. Mobile: none yet (TVRCloud/expense-tracker-mobile#63).

## Rules and gotchas
- Amounts are cents, shown with `useCurrency().formatCurrency`.
- No PDF library: Print uses the browser, and `html[data-print="tax"]` in globals.css hides the navigation while the page is open.
- Realtime `transactions` invalidates `["tax"]`.

## Tests
- `src/test/integrations.test.ts` ("tax helper"), `src/lib/tax-year.test.ts`.

## Last changed
- feat(tax): financial-year summary, deductible categories and CSV
