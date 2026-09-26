import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { ingestCapture } from "@/lib/capture/ingest";

const bodySchema = z.object({
  text: z.string().min(1).max(2000),
  // When the message was actually received (device timestamp). Falls back to
  // now if omitted.
  receivedAt: z.string().datetime().optional(),
});

// POST /api/integrations/sms — raw bank/NBFC SMS text forwarded by n8n.
// Same contract as before: 201 {status:"created", kind, id}, 202
// {status:"queued", reviewItemId}. Newer outcomes: 200 "duplicate" (this
// exact message, or this payment from a higher-priority source, was already
// seen), 200 "updated" (it replaced values from a lower-priority source),
// 200 "ignored" (OTP / offer / due reminder).
//
// Dedupe no longer relies on the idempotency cache: captured_messages keeps a
// unique hash of every message forever (src/lib/capture/ingest.ts).
export const POST = withIntegrationRoute("sms", async ({ req, user, requestId, apiKeyId }) => {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Invalid request body", requestId, {
      details: parsed.error.flatten(),
    });
  }

  const result = await ingestCapture({
    user,
    apiKeyId,
    channel: "n8n",
    text: parsed.data.text,
    receivedAt: parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date(),
  });
  return integrationOk(result.body, requestId, { status: result.httpStatus });
});
