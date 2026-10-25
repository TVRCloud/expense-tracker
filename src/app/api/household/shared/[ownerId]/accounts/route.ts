import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { loadActiveShare, sharedAccountsView } from "@/lib/share-service";

type Params = Promise<{ ownerId: string }>;

// GET /api/household/shared/[ownerId]/accounts — read only; 404 unless you are the member of an active share of this owner.
export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { ownerId } = await ctx.params;
    const shared = await loadActiveShare(user.id, ownerId);
    if (!shared) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: sharedAccountsView(shared) });
  } catch (err) {
    logger.error({ err }, "GET /api/household/shared/[ownerId]/accounts failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
