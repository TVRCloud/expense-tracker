# Goals

`/goals`

**User story**
> As a user, I want to set a savings target with a deadline and watch my progress, and optionally have my spare change swept in automatically, so saving takes less willpower.

**What happens here**
Goal cards show an icon, name, progress toward a target amount, and target date.
Creating a goal includes an icon picker and an optional "round-up" rule: round every
transaction up to a chosen increment and sweep the difference into this goal.

**Key elements**
- Goal cards (icon, name, progress bar, target date)
- Icon picker: 🏠🚗✈️📱💻🎓💍🏖️🎯💼
- Round-up toggle + round-up-to amount
- Delete (confirm dialog)

**Edge cases to design for**
- Goal target date already passed but not yet met
- Multiple goals with round-up enabled — where the swept change actually shows up
- Goal fully funded (celebratory state, or just a "reached" badge?)

> **Not linked from Sidebar, BottomNav, or Dashboard.** Only reachable via the command palette (⌘K/Ctrl+K → "Goals") or a goal-milestone notification deep-link. Direct URL otherwise. Same gap likely applies to Budgets/Loans — worth fixing in the redesign.

**Source:** `src/features/goals/components/GoalsClient.tsx`
