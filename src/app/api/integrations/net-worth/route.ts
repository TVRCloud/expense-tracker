import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { getNetWorth, NET_WORTH_RANGES, type NetWorthRange } from "@/lib/net-worth";

// GET /api/integrations/net-worth?range=30d|90d|1y|all (default 90d) — same
// report as the browser's GET /api/net-worth (src/lib/net-worth.ts). Reading
// it also stores today's point on the trend.
export const GET = withIntegrationRoute("net-worth", async ({ req, user, requestId }) => {
  const raw = new URL(req.url).searchParams.get("range");
  const range: NetWorthRange = NET_WORTH_RANGES.includes(raw as NetWorthRange) ? (raw as NetWorthRange) : "90d";
  return integrationOk(await getNetWorth(user.id, range), requestId);
});
