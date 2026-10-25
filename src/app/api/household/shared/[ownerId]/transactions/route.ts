import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { listSharedTransactions, loadActiveShare } from "@/lib/share-service";
import { shareJsonError } from "@/lib/share-browser";

type Params = Promise<{ ownerId: string }>;

// GET /api/household/shared/[ownerId]/transactions?skip&limit&accountId — read only, shared accounts only.
export async function GET(req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { ownerId } = await ctx.params;
    const shared = await loadActiveShare(user.id, ownerId);
    if (!shared) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const q = req.nextUrl.searchParams;
    return NextResponse.json({
      data: await listSharedTransactions(shared, {
        skip: parseInt(q.get("skip") ?? "0", 10),
        limit: parseInt(q.get("limit") ?? "20", 10),
        accountId: q.get("accountId"),
        type: q.get("type"),
        dateFrom: q.get("dateFrom"),
        dateTo: q.get("dateTo"),
      }),
    });
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "GET /api/household/shared/[ownerId]/transactions failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
