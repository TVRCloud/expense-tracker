import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { beginTotpSetup } from "@/lib/log-security";
import logger from "@/lib/logger";
import { enforceSensitiveActionLimit } from "@/lib/log-auth-request";

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const limited = await enforceSensitiveActionLimit(user.id, "setup", req);
    if (limited) return limited;

    const setup = await beginTotpSetup(user.id, user.email);
    if (!setup.ok) {
      return NextResponse.json({ error: setup.reason }, { status: 409 });
    }
    return NextResponse.json({ data: setup });
  } catch (err) {
    logger.error({ err }, "POST /api/logs/otp/setup failed");
    const message = err instanceof Error && err.message.includes("TOTP_ENCRYPTION_KEY")
      ? err.message
      : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
