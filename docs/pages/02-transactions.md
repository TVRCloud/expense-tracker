# Transactions

`/transactions` (list) · `/transactions/add` · `/transactions/[id]` · `/transactions/recurring[/id]`

**User story**
> As a user, I want to log a purchase in a few taps, split it across categories if needed, search my history, and set up a recurring bill or EMI once instead of re-entering it every month.

---

## List — `/transactions`
**What happens here:** The full ledger. Search, filter by type (Expense/Income/Transfer)
and category, day-grouped rows, "Export CSV", link to the recurring-series area.
Optionally scoped to a single account via `?accountId=`.

**Key elements**
- Search (Enter to apply, Esc to clear)
- Type chips: All / Expense / Income / Transfer
- Category chips: Groceries, Transport, Shopping, Health, Rent, Coffee, Education, Other
- Day-grouped transaction rows, "Load more" pagination
- "Export CSV" link

**Edge cases:** empty search results, first-time user with zero transactions, very long category/description text in a row.

---

## Add — `/transactions/add`
**User story**
> As a user, I want to enter an amount like I would on a calculator, pick a category, and be done — or split it and set it up to repeat, without leaving this screen.

**What happens here:** Numpad-style amount entry with an expense/income toggle, then
either a category grid or a "Split" mode (multiple category+amount lines with a running
"fully allocated / remaining" indicator). Account selector shows credit limit + billing
cycle hint for credit-card accounts. A "Recurring" toggle turns the same entry into a
repeating series.

**Key elements**
- Numpad amount entry, expense/income toggle
- Category grid, or Split toggle (multi-line allocation)
- Account selector (+ `BillingCycleHint` for credit cards)
- Recurring toggle → frequency chips (weekly/bi-weekly/monthly/quarterly/half-yearly/yearly), quick presets ("💰 Monthly salary", "🏦 Monthly EMI"), end condition (never / after N payments / on a date), live recurrence summary text
- Date picker, description, note

**Edge cases:** split doesn't fully allocate the total, recurring end date is in the past, credit-card account with insufficient limit.

---

## Detail — `/transactions/[id]`
**What happens here:** Edit description, category, subcategory, note, tags, date; shows
sibling transactions if this one is part of a split; delete (behind confirm dialog).

---

## Recurring — `/transactions/recurring` and `/transactions/recurring/[recurringId]`
**User story**
> As a user, I want to see all my recurring bills and EMIs in one place, check which installments are paid, and cancel a series if it's no longer needed.

**Key elements**
- List: per-series card — label/category icon, frequency, paid/total count, next-due date, amount, remaining count or "Completed"
- Detail: per-installment status chips (Paid / Upcoming / Overdue / Skipped), progress bar, mark-installment-paid, cancel series (confirm dialog)

**Source:** `src/features/transactions/components/`, `src/features/recurring/components/`
