import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { leaveShare, revokeShare, ShareServiceError, shareUpdateSchema, updateShare } from "@/lib/share-service";
import { readShareJson, shareJsonError } from "@/lib/share-browser";

type Params = Promise<{ id: string }>;

// PATCH /api/household/shares/[id] — the owner changes accounts, role or includeBudgets.
export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await ctx.params;
    const read = await readShareJson(req);
    if (!read.ok) return read.res;
    const parsed = shareUpdateSchema.safeParse(read.body);
    if (!parsed.success) return NextResponse.json({ error: "Change is invalid" }, { status: 400 });
    return NextResponse.json({ data: { share: await updateShare(user.id, id, parsed.data) } });
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "PATCH /api/household/shares/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/household/shares/[id] — the owner ends the share, or the member leaves it.
export async function DELETE(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await ctx.params;
    try {
      return NextResponse.json({ data: await revokeShare(user.id, id) });
    } catch (err) {
      if (!(err instanceof ShareServiceError) || err.code !== "NOT_FOUND") throw err;
      return NextResponse.json({ data: await leaveShare(user, id) });
    }
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "DELETE /api/household/shares/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
