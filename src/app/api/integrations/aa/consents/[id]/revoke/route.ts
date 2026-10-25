import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf } from "@/lib/integrations/write-helpers";
import { aaFailure } from "@/lib/integrations/aa-http";
import { revokeConsent } from "@/lib/aa-service";

// POST /api/integrations/aa/consents/:id/revoke — withdraws the consent now: the provider is told, syncing stops,
// transactions already added stay. { consent, providerRevoked }: false means the provider did not confirm, and the
// person may need to withdraw it at their bank too.
export const POST = withIntegrationRoute<{ params: Promise<{ id: string }> }>("aa", async ({ req, user, requestId }, { params }) => {
  const { id } = await params;
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  try {
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:aa-consent-revoke:POST",
      key,
      body: { id },
      execute: async () => ({ status: 200, body: (await revokeConsent(user.id, id)) as unknown as Record<string, unknown> }),
    });
    if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
    return integrationOk(outcome.body, requestId, { status: outcome.status });
  } catch (err) {
    const res = aaFailure(err, requestId);
    if (res) return res;
    throw err;
  }
});
