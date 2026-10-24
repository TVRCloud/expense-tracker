# API: rules
Purpose: browser CRUD for categorise rules (same merchant, same category and clean name).

## Files
- route.ts: list and create. [id]/route.ts: patch and delete.

## Talks to
- Libs: rule-service (`listRules`, `createRule`, `updateRule`, `deleteRule`, `ruleErrorStatus`).
- Models: Rule, Account.
- UI: none yet. Mobile: `integrations/rules` (same service, API-key auth).

## Rules and gotchas
- All rule logic is in src/lib/rule-service.ts; these routes and `integrations/rules/*` both call it.
- Session auth only (`requireAuth`); errors use the browser's `{error}` shape, 409 for a duplicate match.
- Delete is a hard delete: rules are configuration, not money.

## Tests
- `categorise rules` in `src/test/integrations.test.ts`.

## Last changed
- #72: categorise rules and merchant cleanup
