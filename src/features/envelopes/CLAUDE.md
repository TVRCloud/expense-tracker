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
- Files: `lib/move-key.ts` (tested in `lib/move-key.test.ts`): the move dialog's Idempotency-Key store, at module scope. One key per exact move (month, source, destination, amount, overdraw); A, then B, then A again sends A under its first key; a key is dropped only when its move succeeded or was refused outright (`isDefiniteRefusal`), settled by the mutation in `useMoveEnvelopeMoney` (so leaving the page mid-request keeps it), or by the dialog's "Start over" after a 409 `IDEMPOTENCY_CONFLICT` (the earlier try never reported back; the person checks the plan first). At most 200 unsettled keys are kept. The form is disabled and the dialog cannot be closed while a request is out. A `partial: true` answer to a write means refetch and render nothing from it (the hooks already refetch on settle).
- The move dialog ignores a second submit while pending, so a double click moves once.
- Over-assigning is shown in red, never blocked. An envelope is the exact category string, like a budget.
- Realtime: the `envelopes` resource, and `transactions` and `budgets` events, invalidate `["envelopes"]`.

## Tests
- `src/test/envelopes.test.ts` (service, integration and browser routes), `src/test/backup.test.ts` (envelope plans in a backup).

## Last changed
- feat(envelopes): envelope mode, API and web page
