import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { ruleTestSchema, testRules } from "@/lib/rule-service";

// POST /api/integrations/rules/test — "what would my rules do to this?".
// Read-only (no Idempotency-Key needed, nothing is written): body
// { merchant?, text?, upi? } gives { matched, rule? } for the first matching
// active rule. The app uses it to preview a rule as it is typed.
export const POST = withIntegrationRoute("rules", async ({ req, user, requestId }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = ruleTestSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Give a merchant, a UPI id or message text", requestId, {
      details: parsed.error.flatten(),
    });
  }
  return integrationOk(await testRules(user.id, parsed.data), requestId);
});
