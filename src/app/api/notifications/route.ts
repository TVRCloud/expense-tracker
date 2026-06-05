import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Notification from "@/models/Notification";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread") === "true";
    const skip = parseInt(searchParams.get("skip") ?? "0", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50);

    const query: Record<string, unknown> = { user: user.id };
    if (unreadOnly) query.isRead = false;

    await connectDB();
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ user: user.id, isRead: false }),
    ]);

    return NextResponse.json({ data: notifications, total, unreadCount, skip, limit });
  } catch (err) {
    logger.error({ err }, "GET /api/notifications failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
