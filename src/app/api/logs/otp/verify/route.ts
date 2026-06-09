import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { useRecoveryCode, verifyTotp, verifyTotpSetup } from "@/lib/log-security";
import logger from "@/lib/logger";
import { z } from "zod";
import {
  enforceSensitiveActionLimit,
  getLogDeviceUnlockId,
  getRequestUserAgent,
} from "@/lib/log-auth-request";

const schema = z.object({
  code: z.string().min(6),
  mode: z.enum(["setup", "unlock", "recovery"]).default("unlock"),
});

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    if (!user.jti) {
      return NextResponse.json({ error: "Active session id is missing" }, { status: 401 });
    }

    const { code, mode } = parsed.data;
    const limited = await enforceSensitiveActionLimit(user.id, mode, req);
    if (limited) return limited;

    const result = mode === "setup"
      ? await verifyTotpSetup(user.id, code)
      : mode === "recovery"
        ? await useRecoveryCode(
            user.id,
            user.jti,
            code,
            getLogDeviceUnlockId(req),
            getRequestUserAgent(req)
          )
        : await verifyTotp(
            user.id,
            user.jti,
            code,
            getLogDeviceUnlockId(req),
            getRequestUserAgent(req)
          );

    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    logger.error({ err }, "POST /api/logs/otp/verify failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
