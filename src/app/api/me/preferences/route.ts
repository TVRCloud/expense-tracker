import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const schema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().optional(),
  pushNotifications: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  weekStartsOn: z.number().min(0).max(6).optional(),
  currency: z.string().optional(),
});

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const profile = await User.findById(user.id).select("preferences").lean();
    return NextResponse.json({ data: profile });
  } catch (err) {
    logger.error({ err }, "GET /api/me/preferences failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      updates[`preferences.${k}`] = v;
    }

    await connectDB();
    const updated = await User.findByIdAndUpdate(
      user.id,
      { $set: updates },
      { new: true }
    ).select("preferences").lean();

    return NextResponse.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /api/me/preferences failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
