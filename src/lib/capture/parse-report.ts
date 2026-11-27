// Counts how saved captures parse today, per sender, so we can see which banks the generic parser reads badly and
// which to give a bank parser first (ticket 154). Pure: the script in scripts/capture-parse-report.ts feeds it.
// The report holds counts and sender ids only, never message text, amounts or account digits.

import { CONFIDENCE_AUTO_CREATE, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { normaliseSender } from "@/lib/capture/parsers/sender";

export interface ReportInput {
  text: string;
  receivedAt: Date;
  channel: string;
  sender?: string | null;
  packageName?: string | null;
  /** The parse kind stored when the capture came in, to count how many read differently now. */
  storedKind?: string | null;
}

export interface SenderRow {
  source: string;
  total: number;
  /** Money read at or above the auto-create line. */
  booked: number;
  /** Money read below the line: goes to Review. */
  review: number;
  loan: number;
  ignored: number;
  unknown: number;
  /** Read by a bank parser rather than the generic one or a format. */
  bankParser: number;
  /** Parse kind differs from the one stored at capture time. */
  changed: number;
}

/** The group a capture is counted under: the app package for a notification, the SMS header otherwise. A phone
 * number or anything that is not a header is never printed. */
export function sourceKey(input: Pick<ReportInput, "channel" | "sender" | "packageName">): string {
  const pkg = input.packageName?.trim().toLowerCase();
  if (pkg) return `app:${pkg}`;
  const header = normaliseSender(input.sender);
  if (!header) return `${input.channel}:no sender`;
  if (/^\+?\d+$/.test(header)) return `${input.channel}:phone number`;
  if (!/^[A-Z0-9]{3,9}$/.test(header)) return `${input.channel}:other`;
  return header;
}

const GENERIC_IDS = new Set(["generic", "navi_emi", "idfc_card_spend", "ignore", "none"]);

export function tally(parse: CaptureParse, row: SenderRow) {
  row.total += 1;
  if (parse.kind === "money") {
    if (parse.confidence >= CONFIDENCE_AUTO_CREATE) row.booked += 1;
    else row.review += 1;
  } else if (parse.kind === "loan_emi_payment") row.loan += 1;
  else if (parse.kind === "ignored") row.ignored += 1;
  else row.unknown += 1;
  if (!GENERIC_IDS.has(parse.parserId)) row.bankParser += 1;
}

export function buildReport(inputs: Iterable<ReportInput>, parse = parseCapture): SenderRow[] {
  const rows = new Map<string, SenderRow>();
  for (const input of inputs) {
    const key = sourceKey(input);
    let row = rows.get(key);
    if (!row) {
      row = { source: key, total: 0, booked: 0, review: 0, loan: 0, ignored: 0, unknown: 0, bankParser: 0, changed: 0 };
      rows.set(key, row);
    }
    const result = parse(input.text, input.receivedAt, { sender: input.sender, packageName: input.packageName });
    tally(result, row);
    if (input.storedKind && input.storedKind !== result.kind) row.changed += 1;
  }
  // Most misses first: what lands in Review or comes out unknown is where a bank parser pays off.
  return [...rows.values()].sort((a, b) => b.review + b.unknown - (a.review + a.unknown) || b.total - a.total);
}

export function formatReport(rows: SenderRow[]): string {
  const head = ["source", "total", "booked", "review", "unknown", "ignored", "loan", "bank", "changed"];
  const lines = rows.map((r) => [r.source, r.total, r.booked, r.review, r.unknown, r.ignored, r.loan, r.bankParser, r.changed].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  return [fmt(head), ...lines.map(fmt)].join("\n");
}
