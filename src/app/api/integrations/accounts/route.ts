import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";

// GET /api/integrations/accounts — uncached, matching the existing (uncached)
// GET /api/accounts. Returns the accounts n8n needs to pick a destination for
// a new transaction.
export const GET = withIntegrationRoute("accounts", async ({ user, requestId }) => {
  await connectDB();
  const accounts = await Account.find({ user: user.id, isArchived: false })
    .sort({ createdAt: -1 })
    .select("_id name type balance currency color icon createdAt updatedAt")
    .lean();

  return integrationOk(accounts, requestId);
});
