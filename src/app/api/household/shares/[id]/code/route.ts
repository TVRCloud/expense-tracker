import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { rotateInviteCode } from "@/lib/share-service";
import { shareJsonError } from "@/lib/share-browser";

type Params = Promise<{ id: string }>;

// POST /api/household/shares/[id]/code — a new invite code for a pending invite; the old one stops working.
export async function POST(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await ctx.params;
    const rotated = await rotateInviteCode(user.id, id);
    return NextResponse.json({ data: { share: rotated.share, code: rotated.token } });
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "POST /api/household/shares/[id]/code failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
