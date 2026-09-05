import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";

// GET /api/integrations/goals — same query as GET /api/goals, uncached
// (parity with the existing route, which does no server-side progress calc
// either — savedAmount/targetAmount are returned raw).
export const GET = withIntegrationRoute("goals", async ({ user, requestId }) => {
  await connectDB();
  const goals = await Goal.find({ user: user.id, isDeleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .lean();

  return integrationOk(goals, requestId);
});
