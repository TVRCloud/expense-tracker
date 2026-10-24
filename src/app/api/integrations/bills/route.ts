import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS, listUpcomingBills } from "@/lib/bills";
import { getBillReminderSettings } from "@/lib/bill-settings";

// GET /api/integrations/bills?days=14 — what is coming due: recurring payments,
// credit card statements and loans the user owes, soonest first, with overdue
// ones at the top. `days` is how far ahead to look (0 to 60, default 14);
// overdue bills from the last 60 days are always included. The reminder
// settings come with it so one call fills the screen.
export const GET = withIntegrationRoute("bills", async ({ req, user, requestId }) => {
  const raw = new URL(req.url).searchParams.get("days");
  const parsed = raw === null ? DEFAULT_WINDOW_DAYS : Number.parseInt(raw, 10);
  const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;
  const [bills, settings] = await Promise.all([listUpcomingBills(user.id, { days }), getBillReminderSettings(user.id)]);
  return integrationOk({ bills, settings, days }, requestId);
});
