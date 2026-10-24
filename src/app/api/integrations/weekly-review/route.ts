import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { WeeklyReviewError, getWeeklyReview } from "@/lib/weekly-review";

// GET /api/integrations/weekly-review?week=2026-10-19 — the look back at one
// week (Monday to Sunday on the user's clock): spent, income and the change on
// the week before, top categories and merchants, the biggest expense, a spend
// per day list, no-spend days, how the budgets and the daily spend limit held
// up, the review queue size and one or two plain-language highlights. `week` is
// any date inside the wanted week; without it, the last completed week. The
// notification settings come with it so one call fills the screen.
export const GET = withIntegrationRoute("weekly-review", async ({ req, user, requestId }) => {
  try {
    const review = await getWeeklyReview(user.id, { week: new URL(req.url).searchParams.get("week") });
    return integrationOk(review, requestId);
  } catch (err) {
    if (err instanceof WeeklyReviewError) return integrationError("VALIDATION_ERROR", err.message, requestId, { details: { code: err.code } });
    throw err;
  }
});
