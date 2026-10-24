import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { archiveManualAsset, manualAssetUpdateSchema, NetWorthServiceError, updateManualAsset } from "@/lib/net-worth";

type Params = Promise<{ id: string }>;

// PATCH /api/net-worth/assets/[id] — any of { name, kind, value, note (null clears) }.
export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = manualAssetUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ data: await updateManualAsset(user.id, id, parsed.data) });
  } catch (err) {
    if (err instanceof NetWorthServiceError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "PATCH /api/net-worth/assets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/net-worth/assets/[id] — archives the asset so it stops counting.
export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: await archiveManualAsset(user.id, id) });
  } catch (err) {
    if (err instanceof NetWorthServiceError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "DELETE /api/net-worth/assets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
