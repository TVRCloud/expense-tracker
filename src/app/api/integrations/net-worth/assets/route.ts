import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { createManualAsset, listManualAssets, manualAssetCreateSchema } from "@/lib/net-worth";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

function requireIdempotencyKey(req: NextRequest) {
  const key = req.headers.get("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  return key;
}

function conflictMessage(reason: string) {
  return reason === "fingerprint_mismatch"
    ? "Idempotency-Key was already used with a different request"
    : "A request with this Idempotency-Key is still in progress; retry shortly";
}

// GET /api/integrations/net-worth/assets — the manual assets counted in net worth.
export const GET = withIntegrationRoute("net-worth", async ({ user, requestId }) => {
  return integrationOk(await listManualAssets(user.id), requestId);
});

// POST /api/integrations/net-worth/assets — { name, kind?, value (cents), note? }.
export const POST = withIntegrationRoute("net-worth", async ({ req, user, requestId }) => {
  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = manualAssetCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Asset data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:net-worth-assets:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      const asset = await createManualAsset(user.id, parsed.data);
      return { status: 201, body: asset as unknown as Record<string, unknown> };
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
