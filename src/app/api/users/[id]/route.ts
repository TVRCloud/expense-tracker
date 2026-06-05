import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const updateSchema = z.object({
  role: z.enum(["user", "admin"]).optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
});

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth(["admin"]);
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const target = await User.findById(id)
      .select("-password -passwordResetToken -passwordResetExpires")
      .lean();

    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    logger.info({ adminId: user.id, targetId: id }, "Admin viewed user");
    return NextResponse.json({ data: target });
  } catch (err) {
    logger.error({ err }, "GET /api/users/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth(["admin"]);
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const updated = await User.findByIdAndUpdate(
      id,
      { $set: parsed.data },
      { new: true }
    ).select("-password -passwordResetToken -passwordResetExpires").lean();

    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    logger.info({ adminId: user.id, targetId: id, changes: parsed.data }, "Admin updated user");
    return NextResponse.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /api/users/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
