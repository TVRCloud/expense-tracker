import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { requireAuth, type AuthUser } from "@/lib/auth-guard";
import { ENVELOPE_ERROR_STATUS, EnvelopeError } from "@/lib/envelope-service";
import logger from "@/lib/logger";

// The browser routes' shared shape: session auth, a JSON body checked by the
// zod schema, the service call, and EnvelopeError as its HTTP status. The
// integration routes use integrations/envelope-http.ts instead (API key,
// Idempotency-Key).
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
    return NextResponse.json({ data: await run(parsed.data, user) });
  } catch (err) {
    if (err instanceof EnvelopeError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: ENVELOPE_ERROR_STATUS[err.code] });
    }
    logger.error({ err }, `${label} failed`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
