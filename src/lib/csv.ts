// Minimal CSV serializer for export endpoints — good enough for flat rows of
// strings/numbers, escapes quotes/commas/newlines per RFC 4180.
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);

  // Neutralize formula injection: a cell starting with =, +, -, @, tab, or CR
  // is interpreted as a formula by Excel/Google Sheets when the file is
  // opened, letting a user-controlled field (description/note/tags) run
  // arbitrary formulas (data exfiltration, or DDE command execution) in
  // whoever's spreadsheet app opens the export. Prefixing with a literal
  // quote forces it to be read as text instead.
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;

  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(","));
  return [header, ...body].join("\n");
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
