import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { getReviewInbox } from "@/lib/reconcile/inbox";

// GET /api/integrations/review — the phone's review inbox: auto-captured
// transactions still unreviewed (notification-sourced first), queued
// messages that couldn't be matched, and counts.
export const GET = withIntegrationRoute("review", async ({ user, requestId }) => {
  return integrationOk(await getReviewInbox(user.id), requestId);
});
