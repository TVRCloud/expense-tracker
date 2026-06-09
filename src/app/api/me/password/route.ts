import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { requireAuth } from "@/lib/auth-guard";
import { hashPassword, verifyPassword } from "@/utils/password";
import logger from "@/lib/logger";
import { z } from "zod";
import { revokeAllLogUnlocks } from "@/lib/log-security";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const dbUser = await User.findById(user.id).select("password").lean<{ password: string }>();
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const valid = await verifyPassword(parsed.data.currentPassword, dbUser.password);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const hashed = await hashPassword(parsed.data.newPassword);
    await User.findByIdAndUpdate(user.id, { $set: { password: hashed } });
    await revokeAllLogUnlocks(user.id);

    logger.info({ userId: user.id }, "Password changed");
    return NextResponse.json({ data: { message: "Password updated" } });
  } catch (err) {
    logger.error({ err }, "PATCH /api/me/password failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
