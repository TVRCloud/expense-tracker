import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { sendPushToUser } from "@/lib/push";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";

export async function POST() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const count = await PushSubscription.countDocuments({ user: user.id, isActive: true });
    if (count === 0) {
      return NextResponse.json({ error: "No active subscription on this device" }, { status: 400 });
    }

    await sendPushToUser(user.id, {
      title: "Finance OS test",
      body: "Push notifications are working!",
      url: "/notifications",
    });

    return NextResponse.json({ sent: count });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
