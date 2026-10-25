import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { declineInvite } from "@/lib/share-service";
import { shareJsonError } from "@/lib/share-browser";

type Params = Promise<{ id: string }>;

// POST /api/household/shares/[id]/decline — turn down an invite made for your email.
export async function POST(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await ctx.params;
    return NextResponse.json({ data: { share: await declineInvite(user, id) } });
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "POST /api/household/shares/[id]/decline failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
