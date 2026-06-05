import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Notification from "@/models/Notification";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await req.json() as { isRead?: boolean };

    await connectDB();
    const notification = await Notification.findOneAndUpdate(
      { _id: id, user: user.id },
      { $set: { isRead: body.isRead ?? true } },
      { new: true }
    ).lean();

    if (!notification) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: notification });
  } catch (err) {
    logger.error({ err }, "PATCH /api/notifications/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const notification = await Notification.findOneAndDelete({ _id: id, user: user.id });
    if (!notification) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: { message: "Notification deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/notifications/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
