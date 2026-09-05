import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Accepts a caller-supplied X-Request-ID (validated/sanitized so a malformed
// or oversized value can't be used to pollute logs), otherwise generates one.
// Used to correlate an n8n-side failure with this app's server logs.
export function resolveRequestId(req: NextRequest): string {
  const supplied = req.headers.get("x-request-id");
  if (supplied && REQUEST_ID_PATTERN.test(supplied)) return supplied;
  return randomUUID();
}
