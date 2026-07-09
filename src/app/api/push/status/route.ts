import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const subs = await PushSubscription.find({ user: user.id, isActive: true })
      .select("endpoint userAgent createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({
      hasSubscription: subs.length > 0,
      count: subs.length,
      devices: subs.map((s) => ({
        endpoint: s.endpoint,
        userAgent: s.userAgent ?? null,
        createdAt: s.createdAt,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
