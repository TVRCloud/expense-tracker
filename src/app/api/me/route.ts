import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Session from "@/models/Session";
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

// Soft-delete: reuses the same `isActive` gate auth-options.ts and the
// integration auth layer already enforce for admin-deactivated users, so a
// self-deleted account is immediately blocked from logging in again without
// any new schema or auth-check plumbing.
export async function DELETE() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    await User.findByIdAndUpdate(user.id, { $set: { isActive: false, deletedAt: new Date() } });
    // Also terminate every active session immediately (not just future
    // logins) — same mechanism admin-forced logout already relies on, see
    // the jwt() callback in auth-options.ts checking Session.isActive.
    await Session.updateMany({ user: user.id, isActive: true }, { $set: { isActive: false } });

    return NextResponse.json({ data: { message: "Account deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/me failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
