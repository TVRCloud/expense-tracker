import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readJsonBodyLimited } from "@/lib/integrations/write-helpers";
import { ShareServiceError } from "@/lib/share-service";

const STATUS: Record<ShareServiceError["code"], number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  LIMIT_REACHED: 409,
  ALREADY_SHARED: 409,
  FORBIDDEN_ROLE: 403,
  RATE_LIMITED: 429,
};

/** The JSON error for a household sharing failure in a browser route, or null when it is not one. */
export function shareJsonError(err: unknown) {
  if (!(err instanceof ShareServiceError)) return null;
  const res = NextResponse.json({ error: err.message }, { status: STATUS[err.code] });
  if (err.retryAfterSeconds) res.headers.set("Retry-After", String(Math.max(1, Math.ceil(err.retryAfterSeconds))));
  return res;
}

const MAX_BODY_BYTES = 8 * 1024;

/** A JSON body capped at 8 KB (counted as it is read, like the integration twins), or the error response. */
export async function readShareJson(req: NextRequest) {
  const read = await readJsonBodyLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: read.reason === "too_large" ? "Request body is too large" : "Request body must be valid JSON" },
        { status: read.reason === "too_large" ? 413 : 400 }
      ),
    };
  }
  return { ok: true as const, body: read.body };
}
