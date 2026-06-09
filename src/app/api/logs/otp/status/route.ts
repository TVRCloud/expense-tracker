import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getLogSecurityStatus, isLogsUnlocked } from "@/lib/log-security";
import logger from "@/lib/logger";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const status = await getLogSecurityStatus(user.id);
    const unlocked = await isLogsUnlocked(user.id, user.jti);

    return NextResponse.json({ data: { ...status, unlocked } });
  } catch (err) {
    logger.error({ err }, "GET /api/logs/otp/status failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
