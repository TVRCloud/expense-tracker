import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    await connectDB();
    await PushSubscription.findOneAndUpdate(
      { endpoint: parsed.data.endpoint },
      { ...parsed.data, user: user.id, isActive: true },
      { upsert: true, new: true }
    );

    return NextResponse.json({ data: { message: "Subscribed" } }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/push/subscribe failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
