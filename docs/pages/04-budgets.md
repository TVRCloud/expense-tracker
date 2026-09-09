# Budgets

`/budgets`

**User story**
> As a user, I want to set a monthly spending limit per category and get warned before I blow past it, so I catch overspending while it's still fixable.

**What happens here**
Month/year navigator at the top; below it, one card per category budget showing limit
vs. actual spend as a progress bar. Create, edit, or delete a budget; set an alert
threshold percentage; optionally roll unused budget into next month.

**Key elements**
- Month/year navigator
- Per-category budget cards (limit vs. spent progress bar)
- Add/edit form: category, limit, alert threshold %, active toggle, rollover switch
- Delete (confirm dialog)

**Edge cases to design for**
- Budget already exceeded this month (visual should read as "over", not just a full bar)
- Rollover carrying a surplus into a month where the category is also budgeted normally
- No budgets set yet (empty state, nudge to add one)

> **Not linked from Sidebar, BottomNav, or Dashboard.** Only reachable via the command palette (⌘K/Ctrl+K → "Budgets") or a budget-alert notification deep-link. Worth deciding whether it earns a nav slot during the redesign.

**Source:** `src/features/budgets/components/BudgetsClient.tsx`
