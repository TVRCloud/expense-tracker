import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationError, integrationOk } from "@/lib/integrations/response";
import { getTransactionProvenance } from "@/lib/reconcile/inbox";
import { ReconcileError } from "@/lib/reconcile/correct";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/integrations/review/transactions/:id — one transaction with every
// captured message behind it (source of truth first) and its corrections.
export const GET = withIntegrationRoute<Ctx>("review", async ({ user, requestId }, { params }) => {
  const { id } = await params;
  try {
    return integrationOk(await getTransactionProvenance(user.id, id), requestId);
  } catch (err) {
    if (err instanceof ReconcileError) return integrationError("NOT_FOUND", err.message, requestId);
    throw err;
  }
});
