import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { csvResponse, toCsv } from "@/lib/csv";
import { getTaxSummary, taxCsvColumns, taxCsvRows } from "@/lib/tax-service";
import { parseFy } from "@/lib/tax-year";

// GET /api/tax/export?fy=2025 — the summary as a CSV file for an accountant.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const raw = req.nextUrl.searchParams.get("fy");
    const fy = raw === null ? undefined : parseFy(raw);
    if (fy === null) return NextResponse.json({ error: "fy must be a year such as 2025" }, { status: 400 });
    const summary = await getTaxSummary(user.id, fy);
    return csvResponse(toCsv(taxCsvRows(summary), taxCsvColumns(summary.currency), { numericColumns: [taxCsvColumns(summary.currency)[2]] }), `tax-summary-${summary.label}.csv`);
  } catch (err) {
    logger.error({ err }, "GET /api/tax/export failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
