import { z } from "zod";
import { localDateKey, localMidnight } from "@/lib/spend-limit-time";

// Pure CSV import helpers: parse the text, suggest a column mapping, and turn
// each row into a transaction candidate or an error. No database access here;
// src/lib/transaction-import.ts owns preview, duplicate detection and commit.
// Every loop below is bounded by IMPORT_MAX_BYTES / IMPORT_MAX_ROWS.

export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_COLUMNS = 50;
const MAX_AMOUNT_PAISE = 1e12;

export type CsvTable = { headers: string[]; rows: string[][]; delimiter: string };

export class CsvImportError extends Error {
  code: "TOO_LARGE" | "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS" | "EMPTY";
  constructor(code: CsvImportError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "CsvImportError";
  }
}

function detectDelimiter(firstLine: string): string {
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 parser: quoted cells, doubled quotes, CRLF or LF, a leading BOM. */
export function parseCsv(input: string): CsvTable {
  if (input.length > IMPORT_MAX_BYTES) {
    throw new CsvImportError("TOO_LARGE", "The file is too large to import in one go");
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);

  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endRow = () => {
    row.push(cell);
    cell = "";
    // A line with nothing in it (a trailing newline, a blank line) is not a row.
    if (!(row.length === 1 && row[0].trim() === "")) records.push(row);
    row = [];
    if (records.length > IMPORT_MAX_ROWS + 1) {
      throw new CsvImportError("TOO_MANY_ROWS", `At most ${IMPORT_MAX_ROWS} rows can be imported at a time`);
    }
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
      if (row.length > IMPORT_MAX_COLUMNS) {
        throw new CsvImportError("TOO_MANY_COLUMNS", `At most ${IMPORT_MAX_COLUMNS} columns are supported`);
      }
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) endRow();

  if (records.length === 0) throw new CsvImportError("EMPTY", "The file has no rows");
  const headers = records[0].map((h) => h.trim());
  return { headers, rows: records.slice(1), delimiter };
}

export const IMPORT_FIELDS = ["date", "amount", "debit", "credit", "type", "description", "category", "note", "tags"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

// A column is named by its header text, so the mapping survives a re-order.
export const importMappingSchema = z
  .object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.string().max(200).optional()])) as Record<ImportField, z.ZodOptional<z.ZodString>>)
  .strict();
export type ImportMapping = z.infer<typeof importMappingSchema>;

const HEADER_GUESSES: Record<ImportField, RegExp> = {
  date: /^(transaction |txn |value |posting |booking )?date$|^date of transaction$/i,
  amount: /^(transaction )?amount( \(inr\))?$|^amt$/i,
  debit: /^(debit|withdrawal|withdrawals|dr|paid out|money out)( amount| amt)?(\s*\(inr\))?$/i,
  credit: /^(credit|deposit|deposits|cr|paid in|money in)( amount| amt)?(\s*\(inr\))?$/i,
  type: /^(transaction )?type$|^dr\/cr$/i,
  description: /^(description|narration|particulars|details|merchant|payee|remarks|transaction remarks)$/i,
  category: /^category$/i,
  note: /^notes?$/i,
  tags: /^tags?$/i,
};

/** Guess which header holds which field; leaves a field out when nothing fits. */
export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => h !== "" && !used.has(h) && HEADER_GUESSES[field].test(h));
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  // Separate debit and credit columns win over a lone "amount" guess.
  if (mapping.debit && mapping.credit) delete mapping.amount;
  return mapping;
}

export type DateOrder = "dmy" | "mdy" | "ymd";
export type AmountSign = "signed" | "expense" | "income";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validDate(y: number, m: number, d: number): { y: number; m: number; d: number } | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

function twoDigitYear(y: number) {
  return y < 100 ? 2000 + y : y;
}

/**
 * A date cell to a calendar date. Takes 2026-10-24 (and a time after it),
 * 24/10/2026, 24-10-26, 24.10.2026 and 24 Oct 2026; the day-first or
 * month-first order of the numeric forms is the caller's choice. Under "ymd"
 * only a four-digit year first is read (2026-10-24, 2026/10/24, 2026.10.24).
 */
export function parseDateCell(raw: string, order: DateOrder): { y: number; m: number; d: number } | null {
  const s = raw.trim();
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[\s\-/.]([A-Za-z]{3,9})[\s\-/.,]+(\d{2}|\d{4})(?:[T\s,].*)?$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return month ? validDate(twoDigitYear(Number(m[3])), month, Number(m[1])) : null;
  }

  // Year first (ymd) takes only a four-digit year, handled above: 24-10-26 could
  // as well be day first, so it is refused rather than read the wrong way.
  if (order === "ymd") return null;

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s,].*)?$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = twoDigitYear(Number(m[3]));
    if (order === "mdy") return validDate(y, a, b);
    return validDate(y, b, a);
  }
  return null;
}

// A comma is only ever thousands grouping: 1,234.50 or Indian 1,23,456.78. A
// lone "12,50" could be a decimal comma, so it is refused, not guessed.
const GROUPED = /^(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})+,\d{3})(\.\d{1,2})?$/;

/**
 * "1,234.50", "₹ 1234", "(500.00)", "250 Dr" to integer minor units of the base
 * currency (negative when written so), or null. `exponent` is the number of
 * decimals the currency has: 2 for INR and USD, 0 for JPY, 3 for KWD. Digits
 * past it are accepted only as zeros ("1000.00" for yen), never rounded.
 */
export function parseAmountCell(raw: string, exponent = 2): number | null {
  if (raw.length > 64) return null;
  let s = raw.trim();
  if (!s) return null;
  // Any marker of a negative (brackets, a minus sign, Dr) makes it negative; Cr
  // is a positive marker, so a cell that says both is refused, not guessed.
  let negative = false;
  let credit = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  const suffix = /(dr|cr)\.?$/i.exec(s);
  if (suffix) {
    if (suffix[1].toLowerCase() === "dr") negative = true;
    else credit = true;
    s = s.slice(0, suffix.index).trimEnd();
  }
  s = s.replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/[\s₹]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (negative && credit) return null;
  if (s.includes(",")) {
    if (!GROUPED.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  const m = /^(\d{1,15})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const fraction = m[2] ?? "";
  if (!/^0*$/.test(fraction.slice(exponent))) return null;
  const minor = Number(m[1]) * 10 ** exponent + Number(fraction.slice(0, exponent).padEnd(exponent, "0") || 0);
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_PAISE) return null;
  return negative ? -minor : minor;
}

/** A numeric date whose day and month could swap: 03/04/2026 reads two ways. */
export function dateIsAmbiguous(raw: string): boolean {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s,].*)?$/.exec(raw.trim());
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= 12 && b <= 12 && a !== b;
}

// A cell the export defanged (leading ') comes back as it was written.
function unquoteCell(s: string): string {
  return s.length > 1 && s[0] === "'" && /^['=+\-@\t\r]/.test(s[1]) ? s.slice(1) : s;
}

const EXPENSE_WORDS = /^(expense|debit|dr|withdrawal|withdraw|spent|paid|payment|out|d)$/i;
const INCOME_WORDS = /^(income|credit|cr|deposit|received|in|c)$/i;

export type ImportOptions = {
  mapping: ImportMapping;
  dateOrder: DateOrder;
  amountSign: AmountSign;
  now: Date;
  timeZone: string; // the user's zone: a row lands on its own calendar day there
  exponent?: number; // decimals of the base currency (default 2)
};

export type ImportCandidate = {
  row: number; // 1-based data row, as a person counts them below the header
  date: Date; // the start of that calendar day in the user's time zone
  dateKey: string; // YYYY-MM-DD as written in the file
  type: "income" | "expense";
  amount: number; // integer paise, positive
  description: string;
  category: string;
  note?: string;
  tags: string[];
};

export type ImportRowError = { row: number; field: string; message: string };

export function resolveColumns(headers: string[], mapping: ImportMapping) {
  const index = (name?: string) => (name ? headers.indexOf(name) : -1);
  const out: Partial<Record<ImportField, number>> = {};
  const missing: string[] = [];
  for (const field of IMPORT_FIELDS) {
    const name = mapping[field];
    if (!name) continue;
    const i = index(name);
    if (i < 0) missing.push(name);
    else out[field] = i;
  }
  return { columns: out, missing };
}

/** One row to a candidate, or the reason it cannot be imported. */
export function rowToCandidate(
  cells: string[],
  row: number,
  columns: Partial<Record<ImportField, number>>,
  opts: ImportOptions
): { ok: true; candidate: ImportCandidate } | { ok: false; error: ImportRowError } {
  const cell = (f: ImportField) => (columns[f] === undefined ? "" : (cells[columns[f] as number] ?? "").trim());
  const text = (f: ImportField) => unquoteCell(cell(f));
  const fail = (field: string, message: string) => ({ ok: false as const, error: { row, field, message } });

  const dateCell = cell("date");
  const parsedDate = parseDateCell(dateCell, opts.dateOrder);
  if (!parsedDate) {
    if (!dateCell) return fail("date", "Date is empty");
    // Only a short-year cell is explained this way; a four-digit year that is not a date is just unreadable.
    const hint = opts.dateOrder === "ymd" && /^\d{1,2}[-/.]/.test(dateCell) ? " (year first needs four digits)" : "";
    return fail("date", `Cannot read the date "${dateCell.slice(0, 40)}"${hint}`);
  }
  const year = parsedDate.y;
  if (year < 1990 || Date.UTC(parsedDate.y, parsedDate.m - 1, parsedDate.d) > opts.now.getTime() + 366 * 86_400_000) {
    return fail("date", "Date is out of range");
  }

  let signed: number | null = null;
  let type: "income" | "expense" | null = null;

  if (columns.debit !== undefined || columns.credit !== undefined) {
    const debit = cell("debit") ? parseAmountCell(cell("debit"), opts.exponent) : null;
    const credit = cell("credit") ? parseAmountCell(cell("credit"), opts.exponent) : null;
    if ((cell("debit") && debit === null) || (cell("credit") && credit === null)) return fail("amount", "Cannot read the amount");
    const d = Math.abs(debit ?? 0);
    const c = Math.abs(credit ?? 0);
    if (d > 0 && c > 0) return fail("amount", "Both debit and credit are filled");
    if (d === 0 && c === 0) return fail("amount", "Amount is empty or zero");
    type = d > 0 ? "expense" : "income";
    signed = d > 0 ? d : c;
  } else {
    if (columns.amount === undefined) return fail("amount", "No amount column is mapped");
    const raw = cell("amount");
    signed = parseAmountCell(raw, opts.exponent);
    if (signed === null) return fail("amount", raw ? `Cannot read the amount "${raw.slice(0, 40)}"` : "Amount is empty");
    if (signed === 0) return fail("amount", "Amount is zero");
    const typeCell = cell("type");
    if (typeCell) {
      if (EXPENSE_WORDS.test(typeCell)) type = "expense";
      else if (INCOME_WORDS.test(typeCell)) type = "income";
      else return fail("type", `Cannot read the type "${typeCell.slice(0, 40)}"`);
    } else if (opts.amountSign === "expense") type = "expense";
    else if (opts.amountSign === "income") type = "income";
    else type = signed < 0 ? "expense" : "income";
    signed = Math.abs(signed);
  }

  const tagsCell = text("tags");
  const tags = tagsCell
    ? [...new Set(tagsCell.split(";").map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 10)
    : [];
  const description = text("description").slice(0, 200);
  const category = text("category").slice(0, 50) || "other";
  const note = text("note").slice(0, 500);

  const dateKey = `${String(parsedDate.y).padStart(4, "0")}-${String(parsedDate.m).padStart(2, "0")}-${String(parsedDate.d).padStart(2, "0")}`;
  const start = localMidnight(opts.timeZone, parsedDate.y, parsedDate.m, parsedDate.d);
  // A day some zone skipped (Samoa, 2011-12-30) has no start of its own.
  if (localDateKey(start, opts.timeZone) !== dateKey) return fail("date", "That date does not exist in your time zone");
  return {
    ok: true,
    candidate: {
      row,
      date: start,
      dateKey,
      type,
      amount: signed,
      description,
      category,
      ...(note ? { note } : {}),
      tags,
    },
  };
}
