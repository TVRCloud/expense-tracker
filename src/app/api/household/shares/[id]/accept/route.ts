import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { acceptInvite, shareAcceptSchema } from "@/lib/share-service";
import { shareJsonError } from "@/lib/share-browser";

type Params = Promise<{ id: string }>;

// POST /api/household/shares/[id]/accept { code } — accept an invite made for your email.
export async function POST(req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await ctx.params;
    const raw = (await req.json().catch(() => null)) as { code?: unknown } | null;
    const parsed = shareAcceptSchema.safeParse({ token: raw && typeof raw === "object" ? raw.code : undefined });
    if (!parsed.success) return NextResponse.json({ error: "Enter the invite code" }, { status: 400 });
    return NextResponse.json({ data: { share: await acceptInvite(user, id, parsed.data.token) } });
  } catch (err) {
    const mapped = shareJsonError(err);
    if (mapped) return mapped;
    logger.error({ err }, "POST /api/household/shares/[id]/accept failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
