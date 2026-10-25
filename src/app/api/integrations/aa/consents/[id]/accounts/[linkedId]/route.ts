import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { conflictMessage, idempotencyKeyOf, readJsonBody } from "@/lib/integrations/write-helpers";
import { aaFailure } from "@/lib/integrations/aa-http";
import { mapLinkedAccount } from "@/lib/aa-service";

const bodySchema = z.object({ accountId: z.string().trim().min(1).max(40).nullable() });

// PATCH /api/integrations/aa/consents/:id/accounts/:linkedId — { accountId } feeds that linked bank account into one
// of your accounts, { accountId: null } stops feeding it. Unmapped linked accounts are never read.
export const PATCH = withIntegrationRoute<{ params: Promise<{ id: string; linkedId: string }> }>("aa", async ({ req, user, requestId }, { params }) => {
  const { id, linkedId } = await params;
  const key = idempotencyKeyOf(req);
  if (!key) return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  const read = await readJsonBody(req);
  if (!read.ok) return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) return integrationError("VALIDATION_ERROR", "accountId must be an account id or null", requestId);
  try {
    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: "integrations:aa-consent-account:PATCH",
      key,
      body: { id, linkedId, accountId: parsed.data.accountId },
      execute: async () => ({ status: 200, body: { consent: await mapLinkedAccount(user.id, id, linkedId, parsed.data.accountId) } as Record<string, unknown> }),
    });
    if (outcome.kind === "conflict") return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
    return integrationOk(outcome.body, requestId, { status: outcome.status });
  } catch (err) {
    const res = aaFailure(err, requestId);
    if (res) return res;
    throw err;
  }
});
