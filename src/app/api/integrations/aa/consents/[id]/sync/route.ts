import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { aaFailure } from "@/lib/integrations/aa-http";
import { syncNow } from "@/lib/aa-service";

export const maxDuration = 60;

// POST /api/integrations/aa/consents/:id/sync — reads the new transactions now. Bounded (pages, count and 20 seconds
// per run), repeating it adds nothing twice, and a read right after another is refused (429, retryAfterSeconds).
export const POST = withIntegrationRoute<{ params: Promise<{ id: string }> }>("aa", async ({ user, requestId }, { params }) => {
  const { id } = await params;
  try {
    return integrationOk({ sync: await syncNow(user.id, id) }, requestId);
  } catch (err) {
    const res = aaFailure(err, requestId);
    if (res) return res;
    throw err;
  }
});
