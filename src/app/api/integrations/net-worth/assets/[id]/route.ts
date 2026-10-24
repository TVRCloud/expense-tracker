import { NextRequest } from "next/server";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { archiveManualAsset, manualAssetUpdateSchema, NetWorthServiceError, updateManualAsset } from "@/lib/net-worth";

type Params = Promise<{ id: string }>;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const ID_PATTERN = /^[0-9a-f]{24}$/;

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

// PATCH /api/integrations/net-worth/assets/[id] — any of { name, kind, value, note (null clears) }.
export const PATCH = withIntegrationRoute("net-worth", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return integrationError("VALIDATION_ERROR", "Invalid asset id", requestId);

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
  const parsed = manualAssetUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Asset data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:net-worth-assets:PATCH",
    key: idempotencyKey,
    body: { id, ...parsed.data },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const asset = await updateManualAsset(user.id, id, parsed.data);
        return { status: 200, body: asset as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof NetWorthServiceError) return { status: 404, body: { errorCode: err.code, message: err.message } };
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const out = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (out.errorCode) return integrationError("NOT_FOUND", out.message ?? "Asset not found", requestId);
  return integrationOk(out, requestId, { status: outcome.status });
});

// DELETE /api/integrations/net-worth/assets/[id] — archives the asset so it stops counting.
export const DELETE = withIntegrationRoute("net-worth", async ({ req, user, requestId }, ctx: { params: Params }) => {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return integrationError("VALIDATION_ERROR", "Invalid asset id", requestId);

  const idempotencyKey = requireIdempotencyKey(req);
  if (!idempotencyKey) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:net-worth-assets:DELETE",
    key: idempotencyKey,
    body: { id },
    execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
      try {
        const result = await archiveManualAsset(user.id, id);
        return { status: 200, body: result as unknown as Record<string, unknown> };
      } catch (err) {
        if (err instanceof NetWorthServiceError) return { status: 404, body: { errorCode: err.code, message: err.message } };
        throw err;
      }
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError("IDEMPOTENCY_CONFLICT", conflictMessage(outcome.reason), requestId);
  }
  const out = outcome.body as { errorCode?: string; message?: string } & Record<string, unknown>;
  if (out.errorCode) return integrationError("NOT_FOUND", out.message ?? "Asset not found", requestId);
  return integrationOk(out, requestId, { status: outcome.status });
});
