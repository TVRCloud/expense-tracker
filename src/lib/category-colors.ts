// Category color lookup — single source of truth, consumed by transaction
// rows, budget bars, and the analytics donut chart, so the same category
// (e.g. "Groceries") always renders the same color everywhere in the app
// instead of each surface picking independently. Colors themselves live in
// globals.css (--cat-*) so theming/rebrand only touches one place.
const CAT_COLOR_VARS = new Set([
  "income",
  "groceries",
  "travel",
  "transport",
  "subscription",
  "health",
  "shopping",
  "rent",
  "gym",
  "other",
  "coffee",
  "education",
  "entertainment",
  "emi",
  "transfer",
]);

export function getCategoryColor(category: string): string {
  const key = category.toLowerCase();
  return `var(--cat-${CAT_COLOR_VARS.has(key) ? key : "other"})`;
}
