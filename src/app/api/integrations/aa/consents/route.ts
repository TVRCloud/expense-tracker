import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf } from "@/lib/integrations/write-helpers";
import { aaFailure } from "@/lib/integrations/aa-http";
import { startConsent } from "@/lib/aa-service";

// POST /api/integrations/aa/consents — starts a bank link. 201 { consent, redirectUrl }: the address of the
// provider's consent screen, where the person approves. It is returned in this answer only (the idempotency record
// keeps the consent, not the address), so a retried request answers with redirectUrl null: start a new link instead.
export const POST = withIntegrationRoute("aa", async ({ req, user, requestId }) => {
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  try {
    let redirectUrl: string | null = null;
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:aa-consents:POST",
      key,
      body: { start: true },
      execute: async () => {
        const started = await startConsent(user.id);
        redirectUrl = started.redirectUrl;
        return { status: 201, body: { consent: started.consent } as Record<string, unknown> };
      },
    });
    if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
    return integrationOk({ ...(outcome.body as Record<string, unknown>), redirectUrl }, requestId, { status: outcome.status });
  } catch (err) {
    const res = aaFailure(err, requestId);
    if (res) return res;
    throw err;
  }
});
