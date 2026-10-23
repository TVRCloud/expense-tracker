# Loans
Purpose: money lent or borrowed, with repayment history. Page spec: [docs/pages/06-loans.md](../../../docs/pages/06-loans.md).

## Files
- components/LoansClient.tsx: `/loans` screen, create/edit, repayment list and form.

## Talks to
- `GET/POST /api/loans`, `GET/PATCH/DELETE /api/loans/:id`, `GET/POST /api/loans/:id/repayments`.
- Models: Loan, Repayment, Account, Transaction. Redis caching in the loans routes.
- Mobile: none directly; EMI SMS captures create repayments through the same service.

## Rules and gotchas
- Repayments go through `createRepayment` in src/lib/loan-service.ts, shared with the SMS/capture path. Extend it there.
- `principalAmount` is deliberately not editable in the UI (would desync repayment maths).
- A loan's lender number lets EMI SMS match it automatically ([docs/reconcile.md](../../../docs/reconcile.md), `no_matching_loan`).
- Not linked from the sidebar; reached by command palette or notification.

## Tests
- None in this dir. EMI capture flow: `src/test/integrations.test.ts`.

## Last changed
- e19229d feat(realtime): live updates for every screen and an app event channel
