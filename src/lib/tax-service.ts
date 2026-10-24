import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
import { activityDateAddFields } from "@/lib/transaction-activity";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/spend-limit-time";
import { currentFy, fyBounds, fyLabel, fyMonthKeys } from "@/lib/tax-year";
import { normaliseCategories } from "@/lib/tax-settings";

// Financial-year summary for the tax helper (April to March, in the user's
// time zone). Income and spending come from the same rows as every other
// stat: transfers between own accounts (and ATM withdrawals to cash) are never
// income or spending, voided rows and soft-deleted rows are left out, a recurring
// instalment counts only once paid and on the day it was paid, and a confirmed
// refund comes off spending in the category it was carried over to.
//
// A spend is deductible when its own `deductible` flag is true, or the flag is
// unset and its category is one the user marked deductible. A flag of false
// wins over the category. One Mongo pass groups by kind, month, category and
// that flag; the result is as small as the user's distinct categories times
// the 12 months, never their number of transactions.

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
  category: string;
  deductible: boolean;
  total: number;
  count: number;
}

function rows(map: Map<string, TaxRow>): TaxRow[] {
  return [...map.values()].filter((r) => r.total !== 0).sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

function add(map: Map<string, TaxRow>, category: string, label: string, amount: number) {
  const key = category;
  const row = map.get(key);
  if (row) row.total += amount;
  else map.set(key, { category: label, total: amount });
}

// Pure: turns the grouped rows into the summary figures.
export function foldTaxGroups(groups: TaxGroup[], fy: number): Pick<
  TaxSummary,
  "income" | "expense" | "saved" | "count" | "deductible" | "incomeByCategory" | "expenseByCategory" | "byMonth"
> {
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
    // Sign: a refund takes spending (and deductible spending) back out.
    const sign = g.kind === "refund" ? -1 : 1;
    const amount = g.total * sign;
    const key = g.category.toLowerCase();
    if (g.kind === "income") {
      income += g.total;
      if (month) month.income += g.total;
      add(incomeCats, key, g.category, g.total);
      continue;
    }
    expense += amount;
    if (month) month.expense += amount;
    add(expenseCats, key, g.category, amount);
    if (g.deductible) {
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

export async function getTaxSummary(userId: string, fyArg?: number, now: Date = new Date()): Promise<TaxSummary> {
  await connectDB();
  const { timeZone, categories } = await readUser(userId);
  const fy = fyArg ?? currentFy(now, timeZone);
  const { start, end } = fyBounds(fy, timeZone);
  const userObjectId = new Types.ObjectId(userId);
  const inRange = { $gte: start, $lt: end };

  const aggregated = await Transaction.aggregate<{
    _id: { kind: Kind; month: string; category: string; deductible: boolean };
    label: string;
    total: number;
    count: number;
  }>([
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
        categoryKey: { $toLower: "$category" },
        month: { $dateToString: { format: "%Y-%m", date: "$activityDate", timezone: timeZone } },
      },
    },
    {
      $addFields: {
        deductibleNow: {
          $cond: [
            { $eq: ["$type", "income"] },
            // A refund is spending coming back, in the category it was carried
            // over to: deductible when that category is.
            { $and: [{ $eq: ["$kind", "refund"] }, { $in: ["$categoryKey", { $literal: categories }] }] },
            {
              $or: [
                { $eq: ["$deductible", true] },
                { $and: [{ $ne: ["$deductible", false] }, { $in: ["$categoryKey", { $literal: categories }] }] },
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: { kind: "$kind", month: "$month", category: "$categoryKey", deductible: "$deductibleNow" },
        label: { $first: "$category" },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const groups: TaxGroup[] = aggregated.map((a) => ({
    kind: a._id.kind,
    month: a._id.month,
    category: a.label,
    deductible: a._id.deductible,
    total: a.total,
    count: a.count,
  }));

  return {
    fy,
    label: fyLabel(fy),
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone,
    ...foldTaxGroups(groups, fy),
    deductibleCategories: categories,
    availableYears: await availableYears(userObjectId, timeZone, fy),
  };
}

// Financial years the user has income or spending in, newest first. Always
// includes the year asked for so the picker can show it.
async function availableYears(userObjectId: Types.ObjectId, timeZone: string, fy: number): Promise<number[]> {
  const found = await Transaction.aggregate<{ _id: number }>([
    { $match: countedRows(userObjectId) },
    { $addFields: activityDateAddFields() },
    {
      $addFields: {
        local: { $dateToParts: { date: "$activityDate", timezone: timeZone } },
      },
    },
    {
      $group: {
        _id: { $cond: [{ $gte: ["$local.month", 4] }, "$local.year", { $subtract: ["$local.year", 1] }] },
      },
    },
    { $sort: { _id: -1 } },
    { $limit: 50 },
  ]);
  return [...new Set([fy, ...found.map((f) => f._id)])].sort((a, b) => b - a);
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
