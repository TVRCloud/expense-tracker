import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().optional(),
  currency: z.string().optional(),
});

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const profile = await User.findById(user.id).select("-password -passwordResetToken -passwordResetExpires").lean();
    if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({ data: profile });
  } catch (err) {
    logger.error({ err }, "GET /api/me failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const updated = await User.findByIdAndUpdate(
      user.id,
      { $set: parsed.data },
      { new: true }
    ).select("-password -passwordResetToken -passwordResetExpires").lean();

    return NextResponse.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /api/me failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
