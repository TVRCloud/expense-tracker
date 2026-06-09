import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { beginTotpSetup } from "@/lib/log-security";
import logger from "@/lib/logger";

export async function POST() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const setup = await beginTotpSetup(user.id, user.email);
    return NextResponse.json({ data: setup });
  } catch (err) {
    logger.error({ err }, "POST /api/logs/otp/setup failed");
    const message = err instanceof Error && err.message.includes("TOTP_ENCRYPTION_KEY")
      ? err.message
      : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
