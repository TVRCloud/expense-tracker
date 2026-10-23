# Goals
Purpose: savings goals with progress. Page spec: [docs/pages/05-goals.md](../../../docs/pages/05-goals.md).

## Files
- components/GoalsClient.tsx: `/goals` screen, create and update-progress UI.
- schemas/goal.schema.ts: zod create schema, shared by the form and the service.

## Talks to
- `GET/POST /api/goals`, `GET/PATCH/DELETE /api/goals/:id`.
- Models: Goal; notification `goal_reached` via src/lib/goal-service.ts.
- n8n: `GET/POST /api/integrations/goals`. Mobile: none.

## Rules and gotchas
- "Goal reached" is decided in one place, `checkGoalCompletion` in src/lib/goal-service.ts (ledger entry plus notification). Do not re-check at write sites.
- `applyRoundUp` in the same file also moves `savedAmount`.
- Not linked from the sidebar; reached by command palette or notification.

## Tests
- None in this dir.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
