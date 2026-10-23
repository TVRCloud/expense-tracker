# API: loans
Purpose: loan CRUD and repayments.

## Files
- route.ts: list and create. [id]/route.ts: get, patch, delete.
- [id]/repayments/route.ts: list and record repayments.

## Talks to
- Libs: loan-service (`createLoan`, `updateLoan`, `deleteLoan`, `createRepayment`, list and get helpers), ledger, redis.
- Models: Loan, Repayment, Account, Transaction.
- UI: src/features/loans. Mobile: none.

## Rules and gotchas
- Loan and repayment logic is only in src/lib/loan-service.ts; these routes and `integrations/loans/*` both call it. The capture path also calls it for EMI SMS.
- The PATCH route has no `principalAmount` field, so the principal cannot be edited (UI comment: it would desync repayment maths).
- DELETE soft-deletes the loan, its repayments and linked transactions; SSE sees that as an update ([docs/realtime.md](../../../../docs/realtime.md)).

## Tests
- EMI capture flow and the integration loan routes in `src/test/integrations.test.ts`.

## Last changed
- e38b3f8 Fix ui bugs
