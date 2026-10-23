import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { listNotifications } from "@/lib/notification-service";

// GET /api/integrations/notifications?unread=true&skip&limit — same list as
// GET /api/notifications (newest first, limit capped at 50).
export const GET = withIntegrationRoute("notifications", async ({ req, user, requestId }) => {
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const skip = Math.max(parseInt(searchParams.get("skip") ?? "0", 10) || 0, 0);
  const limit = Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1);

  const { data, total, unreadCount, limit: usedLimit } = await listNotifications(user.id, { unreadOnly, skip, limit });
  return integrationOk({ items: data, total, unreadCount, skip, limit: usedLimit }, requestId);
});
