import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { resolveAnomaly, resolveAnomalySchema } from "@/lib/anomaly-service";

type Params = Promise<{ id: string }>;

// PATCH /api/anomalies/:id — { status: "this_was_me" | "report" | "dismiss" }.
export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await ctx.params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid alert id" }, { status: 400 });
    const body = await req.json().catch(() => null);
    const parsed = resolveAnomalySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Send status as this_was_me, report or dismiss" }, { status: 400 });
    const result = await resolveAnomaly(user.id, id, parsed.data.status);
    if (!result) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    return NextResponse.json({ data: result });
  } catch (err) {
    logger.error({ err }, "PATCH /api/anomalies/:id failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
