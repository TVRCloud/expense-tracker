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

// Freeform category text that doesn't match the canonical taxonomy above
// (e.g. transactions created via the n8n/API integration, which accepts
// any string) used to collapse straight to "other" — every such transaction
// got the same grey "?" icon and the same --cat-other color, which also
// flattened the analytics donut chart to one color for several distinct
// categories. This maps common synonyms to their nearest canonical bucket
// before falling back to "other" for anything genuinely unrecognized.
const CATEGORY_ALIASES: Record<string, string> = {
  salary: "income",
  wage: "income",
  wages: "income",
  payroll: "income",
  bonus: "income",
  fuel: "transport",
  petrol: "transport",
  diesel: "transport",
  gas: "transport",
  cab: "transport",
  taxi: "transport",
  uber: "transport",
  ola: "transport",
  mobile: "subscription",
  recharge: "subscription",
  phone: "subscription",
  sim: "subscription",
  wifi: "subscription",
  broadband: "subscription",
  internet: "subscription",
  food: "groceries",
  lunch: "groceries",
  dinner: "groceries",
  breakfast: "groceries",
  snack: "groceries",
  restaurant: "groceries",
  dining: "groceries",
  grocery: "groceries",
  medical: "health",
  doctor: "health",
  pharmacy: "health",
  hospital: "health",
  housing: "rent",
};

/** Resolves any category text to a key in CAT_COLOR_VARS: the exact match,
 * its alias, or "other" for anything unrecognized. */
export function canonicalizeCategory(category: string): string {
  const key = category.toLowerCase().trim();
  if (CAT_COLOR_VARS.has(key)) return key;
  return CATEGORY_ALIASES[key] ?? "other";
}

export function getCategoryColor(category: string): string {
  return `var(--cat-${canonicalizeCategory(category)})`;
}
