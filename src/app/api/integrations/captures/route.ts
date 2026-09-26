import { z } from "zod";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { ingestCapture } from "@/lib/capture/ingest";

const bodySchema = z.object({
  text: z.string().min(1).max(2000),
  channel: z.enum(["sms", "notification"]),
  // DLT sender id for SMS ("VM-HDFCBK"), app label for a notification.
  sender: z.string().trim().max(64).optional(),
  packageName: z.string().trim().max(200).optional(),
  receivedAt: z.string().datetime(),
  // Channels the phone already merged into this upload (e.g. an SMS that
  // arrived while the matching notification was held).
  alsoSeenIn: z.array(z.enum(["sms", "notification"])).max(2).optional(),
});

// POST /api/integrations/captures — the Android companion app's upload
// endpoint for bank SMS and bank-app notifications. The phone already drops
// anything that isn't from a bank sender or allow-listed bank app, and never
// sends OTPs. Response shape matches /api/integrations/sms, plus 202
// "pending" when a notification is waiting for its SMS.
//
// Retries are safe without an Idempotency-Key: the same text is recognised by
// its content hash and answered with "duplicate".
export const POST = withIntegrationRoute("captures", async ({ req, user, requestId, apiKeyId }) => {
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

  const receivedAt = new Date(parsed.data.receivedAt);
  // Clock skew guard: a phone clock far in the future would otherwise shift
  // the payment date and break cross-channel matching.
  if (receivedAt.getTime() > Date.now() + 10 * 60 * 1000) {
    return integrationError("VALIDATION_ERROR", "receivedAt is in the future", requestId);
  }

  const result = await ingestCapture({
    user,
    apiKeyId,
    channel: parsed.data.channel,
    text: parsed.data.text,
    sender: parsed.data.sender,
    packageName: parsed.data.packageName,
    receivedAt,
    alsoSeenIn: parsed.data.alsoSeenIn,
  });
  return integrationOk(result.body, requestId, { status: result.httpStatus });
});
