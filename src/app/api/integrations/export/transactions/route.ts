import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError } from "@/lib/integrations/response";
import { CSV_BOM } from "@/lib/csv";
import { exportTransactionsCsv, TransactionExportError } from "@/lib/transaction-export";

// GET /api/integrations/export/transactions?accountId&dateFrom&dateTo — a CSV
// file (text/csv with a UTF-8 byte order mark, not the JSON envelope). Dates are YYYY-MM-DD on the user's
// clock. At most 20,000 rows; `X-Export-Truncated: true` says there are more,
// so ask again with a narrower date range. `X-Export-Rows` is the row count.
export const GET = withIntegrationRoute("export", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  try {
    const { csv, rowCount, truncated } = await exportTransactionsCsv({
      userId: user.id,
      accountId: searchParams.get("accountId"),
      dateFrom: searchParams.get("dateFrom"),
      dateTo: searchParams.get("dateTo"),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(CSV_BOM + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="transactions-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
        "X-Export-Rows": String(rowCount),
        "X-Export-Truncated": truncated ? "true" : "false",
      },
    });
  } catch (err) {
    if (err instanceof TransactionExportError) return integrationError("VALIDATION_ERROR", err.message, requestId);
    throw err;
  }
});
