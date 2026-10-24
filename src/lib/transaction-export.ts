import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
import { toCsv } from "@/lib/csv";
import { DEFAULT_TIME_ZONE, isValidTimeZone, localDateKey, localMidnight } from "@/lib/spend-limit-time";

// CSV of a person's transactions for the integrations export. Amounts are in
// major units ("1250.50") so the file reads in a spreadsheet and imports back
// through src/lib/transaction-import.ts. Voided and deleted rows, transfers, and
// planned instalments that have not happened (upcoming, skipped, overdue) are
// left out.

export const EXPORT_MAX_ROWS = 20_000;
export const EXPORT_COLUMNS = [
  "date",
  "type",
  "amount",
  "currency",
  "category",
  "subcategory",
  "description",
  "account",
  "note",
  "tags",
  "source",
];

export function majorUnits(paise: number) {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function dayStart(value: string, timeZone: string, plusDays = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return localMidnight(timeZone, y, mo, d + plusDays);
}

export class TransactionExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionExportError";
  }
}

export type ExportParams = { userId: string; accountId?: string | null; dateFrom?: string | null; dateTo?: string | null };

export async function exportTransactionsCsv(params: ExportParams) {
  await connectDB();
  const user = await User.findById(params.userId).select("preferences.timezone").lean<{ preferences?: { timezone?: string } }>();
  const tzPref = user?.preferences?.timezone;
  const timeZone = tzPref && isValidTimeZone(tzPref) ? tzPref : DEFAULT_TIME_ZONE;

  const filter: Record<string, unknown> = {
    user: params.userId,
    isDeleted: { $ne: true },
    reviewStatus: { $ne: "voided" },
    // Income and spending only: import has no transfers to take back.
    type: { $in: ["income", "expense"] },
    $nor: [{ isRecurring: true, installmentStatus: { $in: ["upcoming", "skipped", "overdue"] } }],
  };
  if (params.accountId) {
    if (!Types.ObjectId.isValid(params.accountId)) throw new TransactionExportError("Invalid account");
    filter.account = params.accountId;
  }
  const range: Record<string, Date> = {};
  if (params.dateFrom) {
    const from = dayStart(params.dateFrom, timeZone);
    if (!from) throw new TransactionExportError("dateFrom must be YYYY-MM-DD");
    range.$gte = from;
  }
  if (params.dateTo) {
    const to = dayStart(params.dateTo, timeZone, 1);
    if (!to) throw new TransactionExportError("dateTo must be YYYY-MM-DD");
    range.$lt = to;
  }
  if (range.$gte || range.$lt) filter.date = range;

  const [accounts, found] = await Promise.all([
    Account.find({ user: params.userId }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
    Transaction.find(filter)
      .sort({ date: 1, _id: 1 })
      .limit(EXPORT_MAX_ROWS + 1)
      .select("date type amount currency category subcategory description account note tags source")
      .lean<
        {
          date: Date;
          type: string;
          amount: number;
          currency?: string;
          category: string;
          subcategory?: string;
          description?: string;
          account: Types.ObjectId;
          note?: string;
          tags?: string[];
          source?: string;
        }[]
      >(),
  ]);

  const names = new Map(accounts.map((a) => [a._id.toString(), a.name]));
  const truncated = found.length > EXPORT_MAX_ROWS;
  const rows = (truncated ? found.slice(0, EXPORT_MAX_ROWS) : found).map((t) => ({
    date: localDateKey(t.date, timeZone),
    type: t.type,
    amount: majorUnits(t.amount),
    currency: t.currency ?? "INR",
    category: t.category,
    subcategory: t.subcategory ?? "",
    description: t.description ?? "",
    account: names.get(t.account.toString()) ?? "",
    note: t.note ?? "",
    tags: (t.tags ?? []).join(";"),
    source: t.source ?? "manual",
  }));

  return { csv: toCsv(rows, EXPORT_COLUMNS), rowCount: rows.length, truncated };
}
