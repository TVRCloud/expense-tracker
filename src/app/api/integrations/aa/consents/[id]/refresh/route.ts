import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { aaFailure } from "@/lib/integrations/aa-http";
import { refreshConsent } from "@/lib/aa-service";

// POST /api/integrations/aa/consents/:id/refresh — asks the provider where the consent stands (call it after
// the person approved) and fills in the linked bank accounts. Safe to repeat, so no Idempotency-Key.
export const POST = withIntegrationRoute<{ params: Promise<{ id: string }> }>("aa", async ({ user, requestId }, { params }) => {
  const { id } = await params;
  try {
    return integrationOk({ consent: await refreshConsent(user.id, id) }, requestId);
  } catch (err) {
    const res = aaFailure(err, requestId);
    if (res) return res;
    throw err;
  }
});
