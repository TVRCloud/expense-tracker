import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import ApiKey from "@/models/ApiKey";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { forgetApiKey } from "@/lib/integrations/auth";

type Params = Promise<{ id: string }>;

// Revokes one of the caller's own keys. Takes effect on the next request,
// since verifyN8nAuth looks the key up with `revoked: false` every time. The
// record is kept (marked revoked with a timestamp), never deleted. No
// password re-check: revoking only takes access away, and it should be quick
// when a key has leaked.
export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    await connectDB();
    // Scoped to user so no one can revoke someone else's key by guessing an id.
    const result = await ApiKey.updateOne(
      { _id: id, user: user.id, revoked: false },
      { $set: { revoked: true, revokedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "API key not found or already revoked" }, { status: 404 });
    }

    forgetApiKey(id);
    logger.info({ userId: user.id, apiKeyId: id }, "API key revoked");
    return NextResponse.json({ data: { message: "API key revoked" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/me/api-keys/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
