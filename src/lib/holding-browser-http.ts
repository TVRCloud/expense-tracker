import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { HoldingError, holdingStatus } from "@/lib/holding-service";

// The browser routes (/api/holdings) share this wrapper: sign-in check, the
// JSON body and schema, and the answer to a HoldingError ({ error } with the
// status from holdingStatus). The integration routes have their own
// (src/lib/integrations/holding-http.ts) because they add an Idempotency-Key.

export async function holdingBrowserRoute<T>(
  name: string,
  req: NextRequest | null,
  opts: { schema?: ZodType<T>; id?: Promise<{ id: string }>; status?: number },
  run: (ctx: { userId: string; input: T; id: string }) => Promise<unknown>
): Promise<Response> {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    let id = "";
    if (opts.id) {
      id = (await opts.id).id;
      if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    let input = undefined as T;
    if (opts.schema) {
      let body: unknown;
      try {
        body = await req!.json();
      } catch {
        return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }
      const parsed = opts.schema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
      input = parsed.data;
    }
    return NextResponse.json({ data: await run({ userId: user.id, input, id }) }, { status: opts.status ?? 200 });
  } catch (err) {
    if (err instanceof HoldingError) return NextResponse.json({ error: err.message, code: err.code }, { status: holdingStatus(err.code) });
    logger.error({ err }, `${name} failed`);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
