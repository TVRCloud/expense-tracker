# Budgets
Purpose: monthly category budgets with spend progress and alert threshold. Page spec: [docs/pages/04-budgets.md](../../../docs/pages/04-budgets.md).

## Files
- components/BudgetsClient.tsx: `/budgets` screen, create/edit form, CSV export link.
- components/SpendLimitCard.tsx: "left today" card at the top of `/budgets` (daily and weekly limit, safe to spend) and its settings dialog.
- hooks/useSpendLimit.ts: `useSpendLimit` / `useUpdateSpendLimit`, query key `["budgets","spend-limit"]`.
- schemas/budget.schema.ts: zod create schema (shared by the form and the server) and `BUDGET_CATEGORIES`. `limitAmount` is capped at `MAX_MINOR_AMOUNT` (1e13).
- schemas/spend-limit.schema.ts: zod update schema shared with src/lib/spend-limit.ts (daily and weekly amounts capped at `MAX_MINOR_AMOUNT`), the status types, rupee and cent helpers. Tested in `spend-limit.schema.test.ts`.

## Talks to
- `GET/POST /api/budgets` (`?format=csv` exports), `GET/PATCH/DELETE /api/budgets/:id`, `GET/PUT /api/spend-limit`.
- Models: Budget (spend comes from Transaction via src/lib/budget-service.ts), SpendLimit (one per user; status from src/lib/spend-limit.ts; a limit change applies from today and the status carries `history`).
- n8n: `GET/POST /api/integrations/budgets` use the same service. Mobile: none.

## Rules and gotchas
- Spend and rollover come from one aggregation in `listBudgetsWithSpend`; web and integration routes must keep using it.
- Alerts are created by src/lib/budget-alert.ts when an expense crosses `alertAt` ([docs/notifications.md](../../../docs/notifications.md)).
- Mutations write ledger blocks (src/lib/ledger.ts).
- A budget and a spend limit amount are base-currency amounts: creating a budget or setting a limit locks the base currency, and a rejected write (a duplicate budget) does not.
- The spend limit key sits under `["budgets"]`, so the budgets and transactions realtime resources refresh it. Amounts are cents on the wire, rupees in the inputs; a blank amount clears that limit. The pause select sends `pausedUntil` as N days from now.
- Not linked from the sidebar; reached by command palette or notification.

## Tests
- `schemas/spend-limit.schema.test.ts`. The server side is in `src/test/integrations.test.ts`.

## Last changed
- c1992c7 fix(currency): lock the base currency atomically, convert bank messages, exact rounding, bounded client rates
