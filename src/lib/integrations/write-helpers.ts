import type { NextRequest } from "next/server";

// The three checks every integration write repeats: a valid Idempotency-Key,
// a JSON body, and the wording of an idempotency conflict. New routes use
// these; older routes keep their own copies.

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

export function idempotencyKeyOf(req: NextRequest): string | null {
  const key = req.headers.get("idempotency-key");
  return key && IDEMPOTENCY_KEY_PATTERN.test(key) ? key : null;
}

export async function readJsonBody(req: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

export function conflictMessage(reason: string) {
  return reason === "fingerprint_mismatch"
    ? "Idempotency-Key was already used with a different request"
    : "A request with this Idempotency-Key is still in progress; retry shortly";
}
