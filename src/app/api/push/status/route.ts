import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const count = await PushSubscription.countDocuments({ user: user.id, isActive: true });

    return NextResponse.json({ hasSubscription: count > 0, count });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
