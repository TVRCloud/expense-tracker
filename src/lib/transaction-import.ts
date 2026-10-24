import { createHash } from "crypto";
import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
import ImportLock from "@/models/ImportLock";
import type { AuthUser } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createTransaction } from "@/lib/transaction-service";
import { getBaseCurrency, lockBaseCurrency } from "@/lib/base-currency";
import { minorExponent } from "@/lib/currency";
import { userTagsOnly } from "@/lib/tags";
import { DEFAULT_TIME_ZONE, isValidTimeZone, localDateKey } from "@/lib/spend-limit-time";
import {
  CsvImportError,
  dateIsAmbiguous,
  IMPORT_MAX_BYTES,
  importMappingSchema,
  parseCsv,
  resolveColumns,
  rowToCandidate,
  suggestMapping,
  type ImportCandidate,
  type ImportMapping,
  type ImportRowError,
} from "@/lib/csv-import";

// Statement and CSV import: a dry run (preview) and the write (commit) over the
// same analysis, so what the person confirms is what is written. Rows get
// source "import". A row is a duplicate when the account already holds one
// with the same calendar day, type and amount; a day with two equal rows in
// the file only matches as many as the account already has, so a re-import of
// the same file adds nothing while two real coffees on one day both survive.

export const importRequestSchema = z
  .object({
    accountId: z.string().refine((v) => Types.ObjectId.isValid(v), "Invalid account"),
    csv: z.string().min(1).max(IMPORT_MAX_BYTES),
    mapping: importMappingSchema.optional(),
    // No default: a file with 03/04/2026 reads two ways, so the commit asks for
    // the order when the file is ambiguous (preview warns and reads day first).
    dateOrder: z.enum(["dmy", "mdy", "ymd"]).optional(),
    amountSign: z.enum(["signed", "expense", "income"]).default("signed"),
  })
  .strict();

export const importCommitSchema = importRequestSchema.extend({
  // Off: rows that look like ones already in the account are left out.
  includeDuplicates: z.boolean().default(false),
  // Off: the rows are history the balance already reflects, so it does not move.
  adjustBalance: z.boolean().default(false),
});

export type ImportRequest = z.infer<typeof importRequestSchema>;
export type ImportCommitRequest = z.infer<typeof importCommitSchema>;

export class TransactionImportError extends Error {
  code: "ACCOUNT_NOT_FOUND" | "NEEDS_MAPPING" | "INVALID_CSV" | "TOO_MANY_EXISTING" | "NEEDS_DATE_ORDER" | "IMPORT_IN_PROGRESS";
  details?: Record<string, unknown>;
  constructor(code: TransactionImportError["code"], message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "TransactionImportError";
  }
}

const ERROR_LIMIT = 50;
const SAMPLE_LIMIT = 20;
export const EXISTING_LIMIT = 20_000;
// The commit route may run 60 s (its maxDuration). The lock and the pending
// idempotency record must outlive a run that is still going, so each is at
// least twice that: a retry never overlaps a live run, and a killed run frees
// its key and lock within a few minutes.
export const IMPORT_PENDING_TTL_SECONDS = 120;
const LOCK_SECONDS = IMPORT_PENDING_TTL_SECONDS;
const DAY_MS = 86_400_000;

export function rowHash(dateKey: string, type: string, amount: number) {
  return createHash("sha256").update(`${dateKey}|${type}|${amount}`).digest("hex").slice(0, 16);
}

type Analysis = {
  // `currency` is the account's label, for display only: every amount is in the base currency.
  account: { id: string; name: string; currency: string };
  baseCurrency: string;
  delimiter: string;
  headers: string[];
  mapping: ImportMapping;
  totalRows: number;
  candidates: (ImportCandidate & { duplicate: boolean })[];
  errors: ImportRowError[];
  ambiguousDates: boolean;
  dateOrder: "dmy" | "mdy" | "ymd";
};

async function userTimeZone(userId: string) {
  const user = await User.findById(userId).select("preferences.timezone").lean<{ preferences?: { timezone?: string } }>();
  const tzPref = user?.preferences?.timezone;
  return tzPref && isValidTimeZone(tzPref) ? tzPref : DEFAULT_TIME_ZONE;
}

async function analyze(userId: string, input: ImportRequest): Promise<Analysis> {
  await connectDB();
  const account = await Account.findOne({ _id: input.accountId, user: userId, isArchived: { $ne: true } })
    .select("name currency")
    .lean<{ _id: Types.ObjectId; name: string; currency?: string }>();
  if (!account) throw new TransactionImportError("ACCOUNT_NOT_FOUND", "Account not found");

  let table;
  try {
    table = parseCsv(input.csv);
  } catch (err) {
    if (err instanceof CsvImportError) throw new TransactionImportError("INVALID_CSV", err.message, { reason: err.code });
    throw err;
  }

  const mapping = input.mapping ?? suggestMapping(table.headers);
  const { columns, missing } = resolveColumns(table.headers, mapping);
  if (missing.length > 0) {
    throw new TransactionImportError("NEEDS_MAPPING", "Some mapped columns are not in the file", { missingColumns: missing });
  }
  const hasAmount = columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
  if (columns.date === undefined || !hasAmount) {
    throw new TransactionImportError("NEEDS_MAPPING", "Map a date column and an amount column (or debit and credit)", {
      mapping,
      headers: table.headers,
    });
  }

  const now = new Date();
  const timeZone = await userTimeZone(userId);
  const baseCurrency = await getBaseCurrency(userId);
  const exponent = minorExponent(baseCurrency);
  const dateOrder = input.dateOrder ?? "dmy";
  const ambiguousDates = table.rows.some((cells) => dateIsAmbiguous(cells[columns.date as number] ?? ""));
  const candidates: ImportCandidate[] = [];
  const errors: ImportRowError[] = [];
  table.rows.forEach((cells, i) => {
    const out = rowToCandidate(cells, i + 1, columns, { mapping, dateOrder, amountSign: input.amountSign, now, timeZone, exponent });
    if (out.ok) candidates.push(out.candidate);
    else errors.push(out.error);
  });

  const duplicates = await markDuplicates(userId, input.accountId, candidates, timeZone);
  return {
    account: { id: input.accountId, name: account.name, currency: account.currency ?? "INR" },
    baseCurrency,
    delimiter: table.delimiter,
    headers: table.headers,
    mapping,
    totalRows: table.rows.length,
    candidates: candidates.map((c, i) => ({ ...c, duplicate: duplicates[i] })),
    errors,
    ambiguousDates,
    dateOrder,
  };
}

async function markDuplicates(
  userId: string,
  accountId: string,
  candidates: ImportCandidate[],
  timeZone: string
): Promise<boolean[]> {
  if (candidates.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const c of candidates) {
    const t = c.date.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const existing = await Transaction.find({
    user: userId,
    account: accountId,
    isDeleted: { $ne: true },
    reviewStatus: { $ne: "voided" },
    type: { $in: ["income", "expense"] },
    date: { $gte: new Date(min - 2 * DAY_MS), $lte: new Date(max + 2 * DAY_MS) },
    // Planned instalments that have not happened are not history.
    $nor: [{ isRecurring: true, installmentStatus: { $in: ["upcoming", "skipped", "overdue"] } }],
  })
    .select("type amount date")
    .sort({ date: 1, _id: 1 })
    .limit(EXISTING_LIMIT + 1)
    .lean<{ type: string; amount: number; date: Date }[]>();
  // Cutting the list short would hide duplicates, so refuse instead.
  if (existing.length > EXISTING_LIMIT) {
    throw new TransactionImportError(
      "TOO_MANY_EXISTING",
      "The account has too many transactions in this file's date range to check for duplicates; import a shorter date span",
      { limit: EXISTING_LIMIT }
    );
  }

  const counts = new Map<string, number>();
  for (const t of existing) {
    const key = rowHash(localDateKey(t.date, timeZone), t.type, t.amount);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return candidates.map((c) => {
    const key = rowHash(c.dateKey, c.type, c.amount);
    const left = counts.get(key) ?? 0;
    if (left > 0) {
      counts.set(key, left - 1);
      return true;
    }
    return false;
  });
}

function warningsOf(a: Analysis, explicit = false) {
  const warnings: string[] = [];
  if (a.ambiguousDates && !explicit) {
    warnings.push(
      "Some dates, like 03/04/2026, can be day first or month first. They were read day first; send dateOrder to confirm. Commit needs it."
    );
  }
  return warnings;
}

function summary(a: Analysis, explicit: boolean) {
  const fresh = a.candidates.filter((c) => !c.duplicate);
  const sum = (type: string) => fresh.filter((c) => c.type === type).reduce((n, c) => n + c.amount, 0);
  return {
    account: a.account,
    baseCurrency: a.baseCurrency,
    minorExponent: minorExponent(a.baseCurrency),
    delimiter: a.delimiter,
    headers: a.headers,
    mapping: a.mapping,
    totalRows: a.totalRows,
    validCount: a.candidates.length,
    duplicateCount: a.candidates.length - fresh.length,
    invalidCount: a.errors.length,
    importCount: fresh.length,
    incomeTotal: sum("income"),
    expenseTotal: sum("expense"),
    errors: a.errors.slice(0, ERROR_LIMIT),
    ambiguousDates: a.ambiguousDates,
    warnings: warningsOf(a, explicit),
    sample: a.candidates.slice(0, SAMPLE_LIMIT).map((c) => ({
      row: c.row,
      date: c.dateKey,
      type: c.type,
      amount: c.amount,
      description: c.description,
      category: c.category,
      tags: c.tags,
      duplicate: c.duplicate,
    })),
  };
}

/** Dry run: reads the file and the account's rows, writes nothing. */
export async function previewImport(userId: string, input: ImportRequest) {
  return summary(await analyze(userId, input), input.dateOrder !== undefined);
}

async function takeLock(userId: string, accountId: string): Promise<string> {
  await ImportLock.init();
  try {
    const lock = await ImportLock.create({ user: userId, account: accountId, expiresAt: new Date(Date.now() + LOCK_SECONDS * 1000) });
    return lock._id.toString();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new TransactionImportError("IMPORT_IN_PROGRESS", "Another import into this account is still running; try again shortly");
    }
    throw err;
  }
}

export async function commitImport(userId: string, actor: AuthUser, input: ImportCommitRequest) {
  await connectDB();
  // One import per account at a time, so the duplicate check below sees every
  // row an earlier import wrote and a retry under a new key cannot double up.
  const lockId = await takeLock(userId, input.accountId);
  try {
    let a = await analyze(userId, input);
    if (a.ambiguousDates && input.dateOrder === undefined) {
      throw new TransactionImportError("NEEDS_DATE_ORDER", "The file has dates that read two ways; send dateOrder (dmy, mdy or ymd)");
    }
    let todo = a.candidates.filter((c) => input.includeDuplicates || !c.duplicate);
    if (todo.length > 0) {
      // The rows are amounts in the base currency, so pin it before writing
      // (lockBaseCurrency's contract: after every check that can reject). If
      // the base changed since the analysis, read the file again against it.
      const locked = await lockBaseCurrency(userId);
      if (locked !== a.baseCurrency) {
        a = await analyze(userId, input);
        todo = a.candidates.filter((c) => input.includeDuplicates || !c.duplicate);
      }
    }
    let imported = 0;
    let failed = 0;
    for (const c of todo) {
      try {
        await createTransaction({
          userId,
          actor,
          accountId: input.accountId,
          type: c.type,
          amount: c.amount,
          currency: a.baseCurrency,
          category: c.category,
          description: c.description || undefined,
          note: c.note,
          date: c.date.toISOString(),
          // A file (our own export includes link tags) can never write the tags the server owns.
          tags: userTagsOnly(c.tags),
          isRecurring: false,
          provenance: { source: "import" },
          skipBalance: !input.adjustBalance,
        });
        imported += 1;
      } catch (err) {
        failed += 1;
        logger.error({ err, userId, row: c.row }, "import row failed");
      }
    }
    return {
      account: a.account,
      baseCurrency: a.baseCurrency,
      totalRows: a.totalRows,
      imported,
      skippedDuplicates: input.includeDuplicates ? 0 : a.candidates.length - todo.length,
      invalidCount: a.errors.length,
      failed,
      errors: a.errors.slice(0, ERROR_LIMIT),
    };
  } finally {
    // By id: if this run outlived its lock, another run may hold a new one.
    await ImportLock.deleteOne({ _id: lockId }).catch((err) =>
      logger.error({ err, userId }, "could not release the import lock")
    );
  }
}
