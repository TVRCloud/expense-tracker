import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { requireAuth, type AuthUser } from "@/lib/auth-guard";
import { ENVELOPE_ERROR_STATUS, EnvelopeError } from "@/lib/envelope-service";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { canonicalJson, idempotencyKeyOf } from "@/lib/integrations/write-helpers";
import logger from "@/lib/logger";

// The browser routes' shared shape: session auth, a JSON body checked by the
// zod schema, the service call, and EnvelopeError as its HTTP status. The
// integration routes use integrations/envelope-http.ts instead (API key,
// Idempotency-Key required).
//
// An Idempotency-Key header is optional here: with one, the write runs once per
// key (a double submit or a retried request does not move money twice) and a
// replay returns the stored answer, errors included. Without one it just runs.
export async function browserEnvelopeWrite<S extends z.ZodType>(
  req: NextRequest,
  label: string,
  schema: S,
  run: (input: z.infer<S>, user: AuthUser) => Promise<unknown>
): Promise<NextResponse> {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    const rawKey = req.headers.get("idempotency-key");
    if (rawKey === null) return NextResponse.json({ data: await run(parsed.data, user) });
    const key = idempotencyKeyOf(req);
    if (!key) return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });

    const outcome = await withIdempotency({
      userId: user.id,
      endpoint: `envelopes:${label}`,
      key,
      body: { request: canonicalJson(parsed.data) },
      execute: async (): Promise<{ status: number; body: Record<string, unknown> }> => {
        try {
          return { status: 200, body: { data: await run(parsed.data, user) } };
        } catch (err) {
          if (err instanceof EnvelopeError) return { status: ENVELOPE_ERROR_STATUS[err.code], body: { error: err.message, code: err.code } };
          throw err;
        }
      },
    });
    if (outcome.kind === "conflict") {
      const message = outcome.reason === "fingerprint_mismatch" ? "Idempotency-Key was already used with a different request" : "A request with this Idempotency-Key is still in progress; retry shortly";
      return NextResponse.json({ error: message, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    }
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    if (err instanceof EnvelopeError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: ENVELOPE_ERROR_STATUS[err.code] });
    }
    logger.error({ err }, `${label} failed`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
