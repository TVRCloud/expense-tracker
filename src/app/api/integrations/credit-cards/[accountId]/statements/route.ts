import { Types } from "mongoose";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { CreditCardServiceError, getCardStatements } from "@/lib/credit-card-service";

type Params = Promise<{ accountId: string }>;

// GET /api/integrations/credit-cards/[accountId]/statements — same data as the
// browser's GET /api/credit-cards/[accountId]/statements. Like that route, it
// creates the statement record for any closed cycle that lacks one.
export const GET = withIntegrationRoute("credit-cards", async ({ user, requestId }, ctx: { params: Params }) => {
  const { accountId } = await ctx.params;
  if (!Types.ObjectId.isValid(accountId)) {
    return integrationError("VALIDATION_ERROR", "Invalid account id", requestId);
  }

  try {
    const { data, currentCycle, message } = await getCardStatements(user, accountId);
    return integrationOk({ statements: data, currentCycle, ...(message ? { message } : {}) }, requestId);
  } catch (err) {
    if (err instanceof CreditCardServiceError) {
      return integrationError(err.code === "ACCOUNT_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR", err.message, requestId);
    }
    throw err;
  }
});
