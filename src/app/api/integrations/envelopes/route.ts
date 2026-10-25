import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { envelopeWrite } from "@/lib/integrations/envelope-http";
import { assignEnvelopes, envelopeAssignSchema, getEnvelopePlan } from "@/lib/envelope-service";

// GET /api/integrations/envelopes?month=YYYY-MM — the month's plan (default:
// this month in the user's time zone): income, assigned, unassigned, each
// envelope with spent and left, budget categories that could become envelopes,
// the latest moves. With envelope mode off: `enabled: false` and an empty plan.
export const GET = withIntegrationRoute("envelopes", async ({ req, user, requestId }) => {
  const month = req.nextUrl.searchParams.get("month");
  if (month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return integrationError("VALIDATION_ERROR", "month must look like 2026-10", requestId);
  }
  return integrationOk(await getEnvelopePlan(user.id, month ?? undefined), requestId);
});

// PUT /api/integrations/envelopes — { month, income?, assign?: [{ category, assigned }], remove?: [category] }.
// Idempotent. Returns the updated plan.
export const PUT = withIntegrationRoute("envelopes", async ({ req, user, requestId }) =>
  envelopeWrite({
    req,
    user,
    requestId,
    endpoint: "integrations:envelopes:PUT",
    schema: envelopeAssignSchema,
    invalidMessage: "Envelope plan is invalid",
    run: (input) => assignEnvelopes(user.id, input),
  })
);
