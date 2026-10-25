# Envelopes
Purpose: optional zero-based budgeting. Each month the person says what income they expect and assigns it to envelopes (a budget category each) until nothing is left unplanned; moving money between envelopes is one step.

## Files
- components/EnvelopesClient.tsx: `/envelopes` page: month stepper, the "left to assign" figure with an allocation bar (one segment per envelope, category colours), editable expected income, a row per envelope (editable assigned amount saved on blur or Enter, spent and left with a bar, move and remove buttons), budget categories offered as chips, an add form, the recent moves, Copy last month for an empty month, Turn on and Turn off. `MoveDialog` picks the destination and amount, with a switch to allow taking money that is already spent.
- hooks/useEnvelopes.ts: `useEnvelopePlan(month)` (key `["envelopes", month]`), `useAssignEnvelopes`, `useMoveEnvelopeMoney`, `useCopyEnvelopePlan`, `useSetEnvelopeMode` (every write refetches on settle).

## Talks to
- `GET`/`PUT /api/envelopes`, `POST /api/envelopes/move`, `POST /api/envelopes/copy`, `GET`/`PUT /api/envelopes/settings`. Libs: src/lib/envelope-service.ts, envelope-browser.ts. Mobile: TVRCloud/expense-tracker-mobile#68.

## Rules and gotchas
- Amounts are minor units of the base currency (`currency`, `exponent` in the answer), shown with `formatMinor`; typed text is turned into minor units with that exponent and anything not a number from 0 up to 1e13 is put back as it was.
- Off by default: with the mode off the page shows a single "Turn on envelopes" card and the API answers an empty plan.
- Over-assigning is shown in red, never blocked. An envelope is the exact category string, like a budget.
- Realtime: the `envelopes` resource, and `transactions` and `budgets` events, invalidate `["envelopes"]`.

## Tests
- `src/test/envelopes.test.ts` (service, integration and browser routes), `src/test/backup.test.ts` (envelope plans in a backup).

## Last changed
- feat(envelopes): envelope mode, API and web page
