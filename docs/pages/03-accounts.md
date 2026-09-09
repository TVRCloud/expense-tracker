# Accounts

`/accounts` (list) · `/accounts/[id]` (detail)

**User story**
> As a user, I want to see all my bank accounts, cash, and credit cards in one place, know my total net assets vs. credit exposure, and manage each account — including paying off a credit card statement — without switching apps.

**What happens here**
List view totals net assets and credit exposure, then lists every account with filter
tabs (All / Credit Cards / Banks & More). Detail view lets you rename/recolor or archive
a regular account; a credit-card account instead opens a dedicated management screen.

**Key elements — list**
- Summary tiles: Net Assets, Credit Exposure
- Filter tabs; per-account rows (credit cards show utilization bar, payable/unbilled amount, EMI commitment badge)
- "Add Account" form: name, type, currency — plus (credit card only) limit, network, last-4, statement day, due day, minimum-payment %

**Key elements — detail (regular account)**
- Inline name/color edit, archive (confirm dialog), recent transactions for that account

**Key elements — detail (credit-card account)**
- Credit-card banner, EMI commitment card, statement list
- **Pay now** — a slide-up sheet to pay a statement in full, minimum, or a custom amount, sourced from another account

**Edge cases to design for**
- Zero accounts (first-run empty state)
- Archived account still referenced by past transactions (should stay visible in history, hidden from active pickers)
- Credit card near/over its limit

**Source:** `src/features/accounts/components/`, `src/features/credit-cards/components/`
