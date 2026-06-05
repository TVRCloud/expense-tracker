import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

export async function DELETE(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json() as { endpoint?: string };
    if (!body.endpoint) {
      return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    }

    await connectDB();
    await PushSubscription.findOneAndUpdate(
      { endpoint: body.endpoint, user: user.id },
      { $set: { isActive: false } }
    );

    return NextResponse.json({ data: { message: "Unsubscribed" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/push/unsubscribe failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
