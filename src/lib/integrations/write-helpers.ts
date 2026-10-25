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

/**
 * A deep, key-sorted JSON string of a body. withIdempotency fingerprints only
 * the top-level keys of what it is given (nested objects lose their own keys),
 * so a route whose body has nested objects or arrays of objects passes
 * `{ request: canonicalJson(body) }` as the fingerprint body instead.
 */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
          .map(([k, val]) => [k, sort(val)])
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function conflictMessage(reason: string) {
  return reason === "fingerprint_mismatch"
    ? "Idempotency-Key was already used with a different request"
    : "A request with this Idempotency-Key is still in progress; retry shortly";
}

/**
 * Like readJsonBody, but counts the bytes as they arrive and stops past
 * `maxBytes`, so a missing or false Content-Length cannot get a big body read.
 */
export async function readJsonBodyLimited(
  req: NextRequest,
  maxBytes: number
): Promise<{ ok: true; body: unknown } | { ok: false; reason: "too_large" | "invalid" }> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!Number.isFinite(Number(declared)) || Number(declared) > maxBytes)) {
    return { ok: false, reason: "too_large" };
  }
  if (!req.body) return { ok: false, reason: "invalid" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
