import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { startTotpRotation } from "@/lib/log-security";
import { enforceSensitiveActionLimit } from "@/lib/log-auth-request";
import logger from "@/lib/logger";
import { z } from "zod";

const schema = z.object({
  currentPassword: z.string().min(1),
  code: z.string().min(6),
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

    const limited = await enforceSensitiveActionLimit(user.id, "rotate-start", req);
    if (limited) return limited;

    const result = await startTotpRotation(user.id, user.email, parsed.data.currentPassword, parsed.data.code);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

    return NextResponse.json({ data: result });
  } catch (err) {
    logger.error({ err }, "POST /api/logs/otp/rotate/start failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
