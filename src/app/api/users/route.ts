import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth(["admin"]);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const skip = parseInt(searchParams.get("skip") ?? "0", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);
    const search = searchParams.get("search");

    const query: Record<string, unknown> = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    await connectDB();
    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -passwordResetToken -passwordResetExpires")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    logger.info({ adminId: user.id, action: "list_users" }, "Admin listed users");
    return NextResponse.json({ data: users, total, skip, limit });
  } catch (err) {
    logger.error({ err }, "GET /api/users failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
