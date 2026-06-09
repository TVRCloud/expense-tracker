import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { lockCurrentLogs } from "@/lib/log-security";
import { getLogDeviceUnlockId } from "@/lib/log-auth-request";
import logger from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    if (!user.jti) return NextResponse.json({ error: "Active session id is missing" }, { status: 401 });

    await lockCurrentLogs(user.id, user.jti, getLogDeviceUnlockId(req));
    return NextResponse.json({ data: { message: "Logs locked" } });
  } catch (err) {
    logger.error({ err }, "POST /api/logs/otp/lock failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
