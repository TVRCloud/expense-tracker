// Minimal CSV serializer for export endpoints — good enough for flat rows of
// strings/numbers, escapes quotes/commas/newlines per RFC 4180.
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  // A real number is never a formula, and a negative one must stay numeric.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let str = String(value);

  // A plain decimal ("-5.00", "1250.50", "125050") is a number, not a formula,
  // and a negative one must stay readable as one: the amount columns arrive here
  // as strings, formatted for the currency's own decimals.
  if (/^-?\d+(\.\d+)?$/.test(str)) return str;

  // Neutralize formula injection: a cell starting with =, +, -, @, tab, or CR
  // is interpreted as a formula by Excel/Google Sheets when the file is
  // opened, letting a user-controlled field (description/note/tags) run
  // arbitrary formulas (data exfiltration, or DDE command execution) in
  // whoever's spreadsheet app opens the export. Prefixing with a literal
  // quote forces it to be read as text instead. A value that already starts
  // with a quote gets one too, so the import can strip exactly one and get the
  // original back.
  if (/^['=+\-@\t\r]/.test(str)) str = `'${str}`;

  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(","));
  return [header, ...body].join("\n");
}

// Excel on Windows reads a CSV as the local code page unless the file starts
// with a UTF-8 byte order mark, and shows ₹ or any non-ASCII text as mojibake.
// Every CSV download starts with it; our importer strips it.
export const CSV_BOM = "\uFEFF";

export function csvResponse(csv: string, filename: string): Response {
  return new Response(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
