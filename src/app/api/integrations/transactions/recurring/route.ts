import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { listRecurringSeries, listUpcomingInstallments } from "@/lib/recurring-series";

// GET /api/integrations/transactions/recurring — same lists as the browser's
// GET /api/transactions/recurring (src/lib/recurring-series.ts): one row per
// series, or `?upcoming=N` for the next N unpaid installments due within 7 days.
// Optional `accountId` filter. A series is created through
// POST /api/integrations/transactions with the recurrence fields.
export const GET = withIntegrationRoute("transactions", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const upcoming = searchParams.get("upcoming");
  const accountId = searchParams.get("accountId");
  if (accountId && !Types.ObjectId.isValid(accountId)) {
    return integrationError("VALIDATION_ERROR", "Invalid accountId", requestId);
  }

  if (upcoming) {
    return integrationOk(await listUpcomingInstallments(user.id, upcoming, accountId), requestId);
  }
  return integrationOk(await listRecurringSeries(user.id, accountId), requestId);
});
