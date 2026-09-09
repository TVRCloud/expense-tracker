# Notifications

`/notifications`

**User story**
> As a user, I want one inbox for every alert the app raises — over-budget, EMI due, credit card due — so I don't miss something and can jump straight to what caused it.

**What happens here**
A list of events raised server-side (budget-alert, EMI-due, credit-due/overdue). Each
notification deep-links to the page it's about (a transaction, account, budget, loan,
or goal).

**Key elements**
- Unread count / "All caught up" empty state
- "Mark all read"
- Per-item mark-as-read / delete
- Unread items get a violet left-border accent

**Edge cases to design for**
- Dozens of unread notifications piling up (does it need grouping/collapsing?)
- A notification whose linked item was since deleted (dead deep-link)

**Source:** `src/features/notifications/components/NotificationsClient.tsx`
