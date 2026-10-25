import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { anomalyListQuerySchema, listAnomalies } from "@/lib/anomaly-service";

// GET /api/integrations/anomalies?status=open|dismissed|confirmed_mine|reported|all&limit&skip
// — unusual-spend alerts, newest first (open ones first with status=all).
// Default status is open, limit 20, at most 50. `openCount` is the number
// still waiting for an answer. Amounts are minor units of the base currency.
export const GET = withIntegrationRoute("anomalies", async ({ req, user, requestId }) => {
  const sp = new URL(req.url).searchParams;
  const parsed = anomalyListQuerySchema.safeParse({
    ...(sp.get("status") !== null ? { status: sp.get("status") } : {}),
    ...(sp.get("limit") !== null ? { limit: sp.get("limit") } : {}),
    ...(sp.get("skip") !== null ? { skip: sp.get("skip") } : {}),
  });
  if (!parsed.success) return integrationError("VALIDATION_ERROR", "status, limit or skip is invalid", requestId);
  return integrationOk(await listAnomalies(user.id, parsed.data), requestId);
});
