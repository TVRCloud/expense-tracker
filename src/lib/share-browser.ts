import { NextResponse } from "next/server";
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
