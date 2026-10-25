# Investments
Purpose: the holdings a person keeps track of by hand (stocks, mutual funds, gold, fixed deposits, PPF): what is worth how much today, the gain or loss, the SIPs coming up, and one total that also counts in net worth.

## Files
- components/InvestmentsClient.tsx: `/investments` page: worth today with gain, the SIPs due soon, holdings grouped by kind with an inline "Update value" (a total, or a price per unit when units are set), remove (asks first, archives), and the add form.
- components/AddHolding.tsx: the add form: a fixed deposit asks for amount, rate and dates; the others for what was put in, today's value and units (both optional) and an optional monthly SIP.
- amount-input.ts: `toMinor` ("1234.5" to 123450, no floats) and `toBps` ("7.25" to 725) for what is typed; tested in `amount-input.test.ts`.
- hooks/useHoldings.ts: `useHoldings()` (key `["holdings"]`), `useAddHolding()`, `useSetHoldingValue()`, `useArchiveHolding()`; mutations call `invalidateForResource(qc, "holdings")`.

## Talks to
- `GET POST /api/holdings`, `GET PATCH DELETE /api/holdings/:id`, `POST /api/holdings/:id/value`.
- Libs: src/lib/holding-service.ts, holding-math.ts, net-worth.ts. Model: Holding.
- Mobile: TVRCloud/expense-tracker-mobile#64 reads `integrations/holdings`.

## Rules and gotchas
- Amounts are minor units of the base currency, shown with `useCurrency().formatCurrency`. Dates are `YYYY-MM-DD` days; the server decides "today" in the person's time zone.
- A fixed deposit's value follows its terms, so it has no "Update value". Holdings never create transactions.
- A holding is separate from accounts: the page tells people not to enter the same money here and as an investment account (the server does not match them).
- Realtime resource `holdings` invalidates `["holdings"]` and `["net-worth"]`.

## Tests
- `src/test/holdings.test.ts`, `src/lib/holding-math.test.ts`, `src/test/backup.test.ts` (holdings), `src/features/investments/amount-input.test.ts`.

## Last changed
- feat: investments (holdings, SIPs, fixed deposits) and their place in net worth and backup
