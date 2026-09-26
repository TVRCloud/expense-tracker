import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError } from "@/lib/integrations/response";
import { integrationReviewMutation } from "@/lib/reconcile/http";
import { resolveCapture, resolveCaptureSchema } from "@/lib/reconcile/inbox";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/integrations/review/captures/:id/resolve — act on a queued
// message. Body {action}: "create" (with the checked values), "link" (same
// payment as the suggested transaction), "keep_mine" / "use_sms" (resolve an
// SMS that disagrees with a confirmed transaction). Requires an
// Idempotency-Key header.
export const POST = withIntegrationRoute<Ctx>("review", async ({ req, user, requestId }, { params }) => {
  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = resolveCaptureSchema.safeParse(json);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Invalid action", requestId, { details: parsed.error.flatten() });
  }
  return integrationReviewMutation({
    req,
    userId: user.id,
    requestId,
    endpoint: `integrations:review:resolve:${id}`,
    body: parsed.data,
    execute: async () => ({
      captureId: id,
      ...(await resolveCapture({ userId: user.id, captureId: id, input: parsed.data, actor: user, via: "mobile" })),
    }),
  });
});
