# Analytics

`/analytics`

**User story**
> As a user, I want to see whether I'm spending more or less than usual, where my money is going by category, and roughly where I'll land by month-end, so I can course-correct before the month is over.

**What happens here**
A 6-month financial overview built entirely around charts. Month navigator at the top,
an Income/Expense tab toggle, and a set of projections estimating where spend will land.

**Charts / visualizations**
- Bar chart — 6-month income vs. expense comparison
- Net-worth trend line/area chart
- Category donut chart (expense tab) + per-category progress bars and % share
- Monthly history rows with income progress bars (income tab)

**Key elements**
- Month navigator, Income/Expense tab toggle
- "Projected by month end" and "Next month, at this pace" callouts

**Edge cases to design for**
- Less than 6 months of data (new user — charts need a sane partial-data state)
- A month with zero income or zero expense (division-by-zero in % calculations)
- This is the one screen where chart legibility matters more than anywhere else — give it real design time.

**Source:** `src/features/analytics/components/`
