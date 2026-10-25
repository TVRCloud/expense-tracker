import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createInvite, listShares, shareInviteSchema } from "@/lib/share-service";
import { readShareJson, shareJsonError } from "@/lib/share-browser";

// GET /api/household/shares — { owned, received } (same as GET /api/integrations/shares).
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await listShares(user) });
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "GET /api/household/shares failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/household/shares — invite: { email, accountIds, role?, includeBudgets? } -> 201 { share, code }.
export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const read = await readShareJson(req);
    if (!read.ok) return read.res;
    const parsed = shareInviteSchema.safeParse(read.body);
    if (!parsed.success) return NextResponse.json({ error: "Invite is invalid" }, { status: 400 });
    const created = await createInvite(user, parsed.data);
    return NextResponse.json({ data: { share: created.share, code: created.token } }, { status: 201 });
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "POST /api/household/shares failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
