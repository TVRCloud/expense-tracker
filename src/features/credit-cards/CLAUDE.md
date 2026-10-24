# Credit cards
Purpose: credit-card views embedded in Accounts, Transactions and Dashboard (limit, utilization, statements, pay now, EMI). No route of its own. Page spec: [docs/pages/13-credit-cards.md](../../../docs/pages/13-credit-cards.md).

## Files
- components/CreditCardDetailClient.tsx: card detail (reached from AccountDetailClient).
- components/CreditCardForm.tsx, CreditCardBanner.tsx, CreditCardSummaryWidget.tsx: create form, banner, dashboard widget.
- components/StatementList.tsx, StatementRow.tsx, PayNowSheet.tsx: statements and paying one.
- components/CreditUtilizationBar.tsx, BillingCycleHint.tsx, EmiCommitmentCard.tsx: small displays.
- components/CardRewardsCard.tsx: rewards on the card detail rail (this cycle's estimate, the rule, a form to set or remove it).
- hooks/useCreditSummary.ts, useCreditStatements.ts, useCardRewards.ts: queries `["credit-summary"]`, `["credit-statements", id]`, `["card-rewards", id]`.

## Talks to
- `GET /api/credit-cards/summary`, `GET`, `PUT`, `DELETE /api/credit-cards/:accountId/rewards`, `GET /api/credit-cards/:accountId/statements`, `PATCH .../statements/:statementId`; `/api/accounts/:id` and `/recalculate`.
- Models: Account (`creditMeta`), CreditStatement, Transaction. Redis: summary cached 60s.
- Mobile: none.

## Rules and gotchas
- Cycle maths lives in src/lib/credit-card.ts and src/lib/credit-balance.ts, not in components.
- Statement list lazily creates records for past cycles and hides empty ones.
- Pay now: the server creates the linked transfer and updates the statement together (PayNowSheet comment).
- Due-date notifications run after the response (credit-notifications.ts).

## Tests
- None in this dir.

## Last changed
- 10a7ed0 feat(ui): Apple-style redesign with full-width responsive layouts
