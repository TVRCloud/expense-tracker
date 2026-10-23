import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { listNotifications } from "@/lib/notification-service";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const skip = parseInt(searchParams.get("skip") ?? "0", 10);
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);

    const page = await listNotifications(user.id, { unreadOnly, skip, limit });

    return NextResponse.json(page);
  } catch (err) {
    logger.error({ err }, "GET /api/notifications failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
