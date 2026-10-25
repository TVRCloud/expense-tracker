# Goals
Purpose: savings goals with progress. Page spec: [docs/pages/05-goals.md](../../../docs/pages/05-goals.md).

## Files
- components/GoalsClient.tsx: `/goals` screen, create and update-progress UI.
- schemas/goal.schema.ts: zod create schema, shared by the form and the service. `targetAmount` and `savedAmount` are capped at `MAX_MINOR_AMOUNT` (1e13).

## Talks to
- `GET/POST /api/goals`, `GET/PATCH/DELETE /api/goals/:id`.
- Models: Goal; notification `goal_reached` via src/lib/goal-service.ts.
- n8n: `GET/POST /api/integrations/goals`. Mobile: none.

## Rules and gotchas
- "Goal reached" is decided in one place, `checkGoalCompletion` in src/lib/goal-service.ts (ledger entry plus notification). Do not re-check at write sites.
- `applyRoundUp` in the same file also moves `savedAmount`.
- Goal amounts are base-currency amounts: creating a goal locks the base currency (src/lib/base-currency.ts).
- Not linked from the sidebar; reached by command palette or notification.

## Tests
- None in this dir.

## Last changed
- c1992c7 fix(currency): lock the base currency atomically, convert bank messages, exact rounding, bounded client rates
