# Budgets
Purpose: monthly category budgets with spend progress and alert threshold. Page spec: [docs/pages/04-budgets.md](../../../docs/pages/04-budgets.md).

## Files
- components/BudgetsClient.tsx: `/budgets` screen, create/edit form, CSV export link.
- schemas/budget.schema.ts: zod create schema, shared by the form and the server.

## Talks to
- `GET/POST /api/budgets` (`?format=csv` exports), `GET/PATCH/DELETE /api/budgets/:id`.
- Models: Budget (spend comes from Transaction via src/lib/budget-service.ts).
- n8n: `GET/POST /api/integrations/budgets` use the same service. Mobile: none.

## Rules and gotchas
- Spend and rollover come from one aggregation in `listBudgetsWithSpend`; web and integration routes must keep using it.
- Alerts are created by src/lib/budget-alert.ts when an expense crosses `alertAt` ([docs/notifications.md](../../../docs/notifications.md)).
- Mutations write ledger blocks (src/lib/ledger.ts).
- Not linked from the sidebar; reached by command palette or notification.

## Tests
- None in this dir.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
