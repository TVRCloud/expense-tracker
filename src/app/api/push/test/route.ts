import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { sendPushToSubscription, webpush } from "@/lib/push";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import { z } from "zod";

const schema = z.object({ endpoint: z.string().url() });

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Missing device endpoint" }, { status: 400 });
    }

    await connectDB();
    const sub = await PushSubscription.findOne({
      endpoint: parsed.data.endpoint,
      user: user.id,
      isActive: true,
    });
    if (!sub) {
      return NextResponse.json({ error: "This device isn't subscribed" }, { status: 404 });
    }

    const result = await sendPushToSubscription(
      { endpoint: sub.endpoint, keys: sub.keys as webpush.PushSubscription["keys"] },
      { title: "Finance OS test", body: "Push notifications are working on this device!", url: "/notifications" }
    );
    if (result.expired) {
      await PushSubscription.findByIdAndUpdate(sub._id, { isActive: false });
      return NextResponse.json({ error: "This device's subscription has expired" }, { status: 410 });
    }

    return NextResponse.json({ sent: 1 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
