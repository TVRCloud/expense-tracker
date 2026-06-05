import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Notification from "@/models/Notification";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

export async function POST() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    await Notification.updateMany({ user: user.id, isRead: false }, { $set: { isRead: true } });
    return NextResponse.json({ data: { message: "All notifications marked as read" } });
  } catch (err) {
    logger.error({ err }, "POST /api/notifications/read-all failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
