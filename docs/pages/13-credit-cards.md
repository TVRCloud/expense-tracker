# Credit Cards (embedded feature, no own route)

Surfaces inside: `/accounts` (add-account form), `/accounts/[id]` (detail), `/transactions/add` (billing-cycle hint), `/dashboard` (summary widget).

**User story**
> As a user, I want to see my credit card's statement, utilization, and upcoming EMI commitments, and pay it off — in full, minimum, or a custom amount — from another one of my accounts, without leaving the app.

**What happens here**
Adding an account with type `credit_card` unlocks extra fields (limit, network, last-4,
statement day, due day, minimum-payment %). Its detail page then renders a dedicated
credit-card view instead of the generic account detail.

**Key elements**
- `CreditCardBanner` — card-style summary
- `EmiCommitmentCard` — running EMI obligations tied to this card
- `StatementList` / `StatementRow` — past statements
- `CreditUtilizationBar` — balance vs. limit
- **Pay now** (`PayNowSheet`) — bottom sheet: pay full / minimum / custom amount, sourced from another account
- `BillingCycleHint` — shown on the add-transaction screen when a credit-card account is selected
- `CreditCardSummaryWidget` — Dashboard widget, only rendered if the user holds a card

**Edge cases to design for**
- Card at or over its limit
- Statement due today / overdue (should visually differ from "due in 20 days")
- Paying more than the statement balance (overpayment handling)

**Source:** `src/features/credit-cards/components/`
