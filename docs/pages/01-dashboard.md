# Dashboard

`/dashboard` — first screen after login.

**User story**
> As a user, I want to see my net worth, this month's income/spend, and my accounts the moment I open the app, so I don't have to dig through menus to know where I stand.

**What happens here**
Home screen. Shows a balance card (net worth + income + expense for the month), every
account as a horizontally-scrollable "wallet card", a recent-transactions list, and
(only when relevant) a credit-card summary and an upcoming-payments widget.

**Key elements**
- Balance card — net worth, income, expense (skeleton while loading)
- Accounts as swipeable wallet cards + "See all" → Accounts
- Recent transactions list + "See all" → Transactions
- Credit card summary widget — only shown if the user has a credit-card account
- Upcoming payments widget — recurring charges and EMI due dates
- Desktop only: month breakdown (income vs. spend progress bars, net saved)

**Edge cases to design for**
- New user with zero accounts / zero transactions (empty state)
- User with 5+ accounts (how the wallet-card scroll behaves)
- No credit card / no recurring payments (widgets simply don't render — layout shouldn't leave a hole)

**Source:** `src/features/dashboard/components/DashboardClient.tsx`
