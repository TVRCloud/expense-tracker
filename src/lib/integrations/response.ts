import { NextResponse } from "next/server";

// Response/error convention for the /api/integrations/* surface only. The
// rest of the app keeps its existing ad hoc {data}/{error} convention — this
// is scoped to integration routes because n8n needs a stable, machine-readable
// shape to branch workflows on.

export const INTEGRATION_ERROR_STATUS = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type IntegrationErrorCode = keyof typeof INTEGRATION_ERROR_STATUS;

export function integrationOk<T>(data: T, requestId: string, init?: { status?: number }) {
  const res = NextResponse.json({ success: true, data, requestId }, { status: init?.status ?? 200 });
  res.headers.set("X-Request-ID", requestId);
  return res;
}

export function integrationError(
  code: IntegrationErrorCode,
  message: string,
  requestId: string,
  extra?: Record<string, unknown>
) {
  const status = INTEGRATION_ERROR_STATUS[code];
  const res = NextResponse.json(
    { success: false, error: { code, message, ...extra }, requestId },
    { status }
  );
  res.headers.set("X-Request-ID", requestId);
  return res;
}
