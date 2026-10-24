import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
import { activityDateAddFields } from "@/lib/transaction-activity";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/spend-limit-time";
import { currentFy, fyBounds, fyLabel, fyMonthKeys } from "@/lib/tax-year";
import { categoryKey, normaliseCategories } from "@/lib/tax-settings";

// Financial-year summary for the tax helper (April to March, in the user's
// time zone). Income and spending come from the same rows as every other
// stat: transfers between own accounts are never income or spending (an ATM
// withdrawal is one only when the user has a cash account, otherwise it stays
// an expense), voided rows and soft-deleted rows are left out, and a recurring
// instalment counts only once paid and on the day it was paid.
//
// A confirmed refund comes off spending in the year it arrived (cash basis,
// by the refund's own date), so a refund in a later year than its purchase
// makes that later year's spending lower. It is skipped when the expense it
// refunds is voided or deleted. It is deductible exactly when that expense is.
//
// A spend is deductible when its own `deductible` flag is true, or the flag is
// unset and its category is one the user marked deductible. A flag of false
// wins over the category. One Mongo pass groups by kind, month, category and
// flag; the flag and the category match are then worked out in JS with one
// shared name comparison (categoryKey). The result is as small as the user's
// distinct categories times the 12 months, never their number of transactions.

export type TaxRow = { category: string; total: number };
export type TaxMonth = { month: string; income: number; expense: number; deductible: number };

export interface TaxSummary {
  fy: number;
  label: string;
  /** First instant of the year (ISO, UTC) and the first instant after it. */
  start: string;
  end: string;
  timeZone: string;
  /** Paise. `expense` is net of confirmed refunds. */
  income: number;
  expense: number;
  /** income - expense; negative when more was spent than earned. */
  saved: number;
  /** Income, expense and refund rows counted. */
  count: number;
  deductible: { total: number; byCategory: TaxRow[] };
  incomeByCategory: TaxRow[];
  expenseByCategory: TaxRow[];
  /** April first, always 12 entries. */
  byMonth: TaxMonth[];
  /** The user's deductible category names, as stored (lower case). */
  deductibleCategories: string[];
  /** Years that have any data, newest first, for a year picker. */
  availableYears: number[];
}

export type Kind = "income" | "expense" | "refund";
export interface TaxGroup {
  kind: Kind;
  month: string;
  /** The category shown. */
  category: string;
  /** The category the deductible rule is matched on: for a refund, the refunded expense's. */
  ruleCategory: string;
  /** The row's own flag (for a refund, the refunded expense's); null when unset. */
  override: boolean | null;
  total: number;
  count: number;
}

function rows(map: Map<string, TaxRow>): TaxRow[] {
  return [...map.values()].filter((r) => r.total !== 0).sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

function add(map: Map<string, TaxRow>, key: string, label: string, amount: number) {
  const row = map.get(key);
  if (row) row.total += amount;
  else map.set(key, { category: label, total: amount });
}

// Pure: turns the grouped rows into the summary figures. `categories` are the
// user's deductible names (already through categoryKey).
export function foldTaxGroups(groups: TaxGroup[], fy: number, categories: string[] = []): Pick<
  TaxSummary,
  "income" | "expense" | "saved" | "count" | "deductible" | "incomeByCategory" | "expenseByCategory" | "byMonth"
> {
  const listed = new Set(categories.map(categoryKey));
  const months = new Map<string, TaxMonth>(fyMonthKeys(fy).map((m) => [m, { month: m, income: 0, expense: 0, deductible: 0 }]));
  const incomeCats = new Map<string, TaxRow>();
  const expenseCats = new Map<string, TaxRow>();
  const dedCats = new Map<string, TaxRow>();
  let income = 0;
  let expense = 0;
  let count = 0;
  let dedTotal = 0;

  for (const g of groups) {
    count += g.count;
    const month = months.get(g.month);
    const key = categoryKey(g.category);
    if (g.kind === "income") {
      income += g.total;
      if (month) month.income += g.total;
      add(incomeCats, key, g.category, g.total);
      continue;
    }
    // A refund takes spending (and deductible spending) back out.
    const amount = g.kind === "refund" ? -g.total : g.total;
    expense += amount;
    if (month) month.expense += amount;
    add(expenseCats, key, g.category, amount);
    if (g.override ?? listed.has(categoryKey(g.ruleCategory))) {
      dedTotal += amount;
      if (month) month.deductible += amount;
      add(dedCats, key, g.category, amount);
    }
  }

  return {
    income,
    expense,
    saved: income - expense,
    count,
    deductible: { total: dedTotal, byCategory: rows(dedCats) },
    incomeByCategory: rows(incomeCats),
    expenseByCategory: rows(expenseCats),
    byMonth: [...months.values()],
  };
}

type TaxUserDoc = { preferences?: { timezone?: string; tax?: { deductibleCategories?: string[] } } } | null;

async function readUser(userId: string) {
  const doc = await User.findById(userId).select("preferences.timezone preferences.tax").lean<TaxUserDoc>();
  const tz = doc?.preferences?.timezone;
  return {
    timeZone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
    categories: normaliseCategories(doc?.preferences?.tax?.deductibleCategories ?? []),
  };
}

// Rows that count toward any stat: income and spending only, not voided, and
// recurring instalments only once paid.
function countedRows(userObjectId: Types.ObjectId) {
  return {
    user: userObjectId,
    isDeleted: { $ne: true },
    type: { $in: ["income", "expense"] },
    reviewStatus: { $ne: "voided" },
    $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
  };
}

export const ID_CHUNK = 1000;

type Refunded = { _id: Types.ObjectId; category?: string; deductible?: boolean; isDeleted?: boolean; reviewStatus?: string | null };

// The expenses refunds point at, this user's only, read in chunks.
export async function refundedExpenses(userObjectId: Types.ObjectId, ids: Array<Types.ObjectId | null>) {
  const unique = [...new Map(ids.filter((i): i is Types.ObjectId => !!i).map((i) => [i.toString(), i])).values()];
  const found = new Map<string, Refunded>();
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = await Transaction.find({ _id: { $in: unique.slice(i, i + ID_CHUNK) }, user: userObjectId })
      .select("category deductible isDeleted reviewStatus")
      .lean<Refunded[]>();
    for (const doc of chunk) found.set(doc._id.toString(), doc);
  }
  return found;
}

export async function getTaxSummary(userId: string, fyArg?: number, now: Date = new Date()): Promise<TaxSummary> {
  await connectDB();
  const { timeZone, categories } = await readUser(userId);
  const fy = fyArg ?? currentFy(now, timeZone);
  const { start, end } = fyBounds(fy, timeZone);
  const userObjectId = new Types.ObjectId(userId);
  const inRange = { $gte: start, $lt: end };

  // Rows of the year with their kind and month; refunds are told apart from income.
  const inYear = [
    { $match: { ...countedRows(userObjectId), $or: [{ date: inRange }, { paidAt: inRange }] } },
    { $addFields: activityDateAddFields() },
    { $match: { activityDate: inRange } },
    {
      $addFields: {
        kind: {
          $cond: [
            { $and: [{ $eq: ["$type", "income"] }, { $eq: ["$refundStatus", "confirmed"] }] },
            "refund",
            "$type",
          ],
        },
        month: { $dateToString: { format: "%Y-%m", date: "$activityDate", timezone: timeZone } },
      },
    },
  ];

  const [plain, refunds] = await Promise.all([
    Transaction.aggregate<{
      _id: { kind: Kind; month: string; category: string; override: boolean | null };
      total: number;
      count: number;
    }>([
      ...inYear,
      { $match: { kind: { $ne: "refund" } } },
      {
        $group: {
          _id: { kind: "$kind", month: "$month", category: "$category", override: { $ifNull: ["$deductible", null] } },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    // One group per refunded expense, month and category: at most as many as
    // the year's refunds. Never cut short: a dropped group would be a wrong total.
    Transaction.aggregate<{
      _id: { refundOf: Types.ObjectId | null; month: string; category: string };
      total: number;
      count: number;
    }>([
      ...inYear,
      { $match: { kind: "refund" } },
      {
        $group: {
          _id: { refundOf: { $ifNull: ["$refundOf", null] }, month: "$month", category: "$category" },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const originals = await refundedExpenses(userObjectId, refunds.map((r) => r._id.refundOf));

  const groups: TaxGroup[] = plain.map((a) => ({
    kind: a._id.kind,
    month: a._id.month,
    category: a._id.category,
    ruleCategory: a._id.category,
    override: a._id.override,
    total: a.total,
    count: a.count,
  }));
  for (const r of refunds) {
    const original = r._id.refundOf ? originals.get(r._id.refundOf.toString()) : undefined;
    // Skipped when the expense it refunds is voided or deleted; deductible as
    // that expense is (its flag, else its category). Unlinked: its own category.
    if (original && (original.isDeleted || original.reviewStatus === "voided")) continue;
    groups.push({
      kind: "refund",
      month: r._id.month,
      category: r._id.category,
      ruleCategory: original?.category ?? r._id.category,
      override: original?.deductible ?? null,
      total: r.total,
      count: r.count,
    });
  }

  return {
    fy,
    label: fyLabel(fy),
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone,
    ...foldTaxGroups(groups, fy, categories),
    deductibleCategories: categories,
    availableYears: await availableYears(userObjectId, timeZone, fy),
  };
}

const MAX_YEARS = 100;

type Dated = { date?: Date; paidAt?: Date } | null;

// The single-row reads behind availableYears, not yet run (so a test can
// explain them). `isDeleted` is matched with equality points ($in false or
// null), not $ne, so the {user, isDeleted, date} and {user, isDeleted, paidAt}
// indexes give the order and each read stops at its first row.
//
// The range is the first to the last `date` over all counted rows, widened by
// the first and last `paidAt` (a paid instalment counts on the day it was
// paid). A paid instalment whose scheduled date is far from its paid date can
// stretch the range by a year, so the list never misses a year but may offer
// one with no counted row.
export function yearRangeReads(userObjectId: Types.ObjectId) {
  const { isDeleted: _ignored, ...counted } = countedRows(userObjectId);
  void _ignored;
  const live = { ...counted, isDeleted: { $in: [false, null] } };
  const paid = { ...live, installmentStatus: "paid", paidAt: { $gte: new Date(0) } };
  return {
    firstDate: Transaction.findOne(live).sort({ date: 1 }).select("date").lean<Dated>(),
    lastDate: Transaction.findOne(live).sort({ date: -1 }).select("date").lean<Dated>(),
    firstPaid: Transaction.findOne(paid).sort({ paidAt: 1 }).select("paidAt").lean<Dated>(),
    lastPaid: Transaction.findOne(paid).sort({ paidAt: -1 }).select("paidAt").lean<Dated>(),
  };
}

// Financial years from the first to the last counted row, newest first, always
// including the year asked for. Cost does not grow with the number of
// transactions. Years in between with no rows are listed too.
async function availableYears(userObjectId: Types.ObjectId, timeZone: string, fy: number): Promise<number[]> {
  const reads = yearRangeReads(userObjectId);
  const [firstDate, lastDate, firstPaid, lastPaid] = await Promise.all([reads.firstDate, reads.lastDate, reads.firstPaid, reads.lastPaid]);
  const stamps = [firstDate?.date, lastDate?.date, firstPaid?.paidAt, lastPaid?.paidAt].filter((d): d is Date => !!d);
  if (stamps.length === 0) return [fy];
  const years = stamps.map((d) => currentFy(d, timeZone));
  const low = Math.min(...years);
  const high = Math.max(...years);
  const list: number[] = [];
  for (let y = high; y >= low && list.length < MAX_YEARS; y--) list.push(y);
  return [...new Set([fy, ...list])].sort((a, b) => b - a);
}

// "1234.5" style rupee figure for the CSV (a number, so a negative stays numeric).
const rupees = (paise: number) => Number((paise / 100).toFixed(2));

export function taxCsvRows(s: TaxSummary): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [
    { section: "Summary", name: "Financial year", amount: s.label },
    { section: "Summary", name: "Income", amount: rupees(s.income) },
    { section: "Summary", name: "Spending", amount: rupees(s.expense) },
    { section: "Summary", name: "Saved", amount: rupees(s.saved) },
    { section: "Summary", name: "Deductible spending", amount: rupees(s.deductible.total) },
  ];
  for (const m of s.byMonth) {
    out.push({ section: "Income by month", name: m.month, amount: rupees(m.income) });
  }
  for (const m of s.byMonth) {
    out.push({ section: "Spending by month", name: m.month, amount: rupees(m.expense) });
  }
  for (const r of s.deductible.byCategory) out.push({ section: "Deductible by category", name: r.category, amount: rupees(r.total) });
  for (const r of s.incomeByCategory) out.push({ section: "Income by category", name: r.category, amount: rupees(r.total) });
  for (const r of s.expenseByCategory) out.push({ section: "Spending by category", name: r.category, amount: rupees(r.total) });
  return out;
}

export const TAX_CSV_COLUMNS = ["section", "name", "amount"];

/** Marks one expense deductible (true), not deductible (false) or back to the category rule (null). */
export async function setTransactionDeductible(
  userId: string,
  transactionId: string,
  deductible: boolean | null
): Promise<{ id: string; deductible: boolean | null } | null> {
  await connectDB();
  const update = deductible === null ? { $unset: { deductible: 1 } } : { $set: { deductible } };
  const doc = await Transaction.findOneAndUpdate(
    { _id: transactionId, user: userId, isDeleted: { $ne: true }, type: "expense" },
    update,
    { new: true }
  )
    .select("deductible")
    .lean<{ _id: Types.ObjectId; deductible?: boolean }>();
  return doc ? { id: doc._id.toString(), deductible: doc.deductible ?? null } : null;
}
