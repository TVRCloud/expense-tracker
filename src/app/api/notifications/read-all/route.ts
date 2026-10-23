import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { markAllNotificationsRead } from "@/lib/notification-service";

export async function POST() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await markAllNotificationsRead(user.id);
    return NextResponse.json({ data: { message: "All notifications marked as read" } });
  } catch (err) {
    logger.error({ err }, "POST /api/notifications/read-all failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
