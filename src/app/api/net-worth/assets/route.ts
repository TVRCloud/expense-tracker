import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createManualAsset, listManualAssets, manualAssetCreateSchema } from "@/lib/net-worth";

// GET /api/net-worth/assets — the manual assets (property, gold, ...) counted in net worth.
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await listManualAssets(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/net-worth/assets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/net-worth/assets — { name, kind?, value (cents), note? }.
export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const parsed = manualAssetCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ data: await createManualAsset(user.id, parsed.data) }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/net-worth/assets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
