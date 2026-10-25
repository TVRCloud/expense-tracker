import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { envelopeWrite } from "@/lib/integrations/envelope-http";
import { envelopeSettingsSchema, getEnvelopeSettings, setEnvelopesEnabled } from "@/lib/envelope-service";

// GET /api/integrations/envelopes/settings — { enabled }.
export const GET = withIntegrationRoute("envelopes", async ({ user, requestId }) => {
  return integrationOk(await getEnvelopeSettings(user.id), requestId);
});

// PUT /api/integrations/envelopes/settings — { enabled }: turn envelope mode on
// or off. Turning it off keeps every plan; it just stops showing them.
export const PUT = withIntegrationRoute("envelopes", async ({ req, user, requestId }) =>
  envelopeWrite({
    req,
    user,
    requestId,
    endpoint: "integrations:envelopes:settings",
    schema: envelopeSettingsSchema,
    invalidMessage: "Send enabled as true or false",
    run: (input) => setEnvelopesEnabled(user.id, input.enabled),
  })
);
