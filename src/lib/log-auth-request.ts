import { NextRequest, NextResponse } from "next/server";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";

export const LOG_DEVICE_HEADER = "x-logs-device-id";

export function getLogDeviceUnlockId(req: NextRequest) {
  return req.headers.get(LOG_DEVICE_HEADER) ?? "";
}

export function getRequestUserAgent(req: NextRequest) {
  return req.headers.get("user-agent") ?? "";
}

export async function enforceSensitiveActionLimit(userId: string, action: string, req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rate = await checkSecurityRateLimit({
    key: `logs:${action}:${userId}:${ip}`,
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (rate.allowed) return null;

  return NextResponse.json(
    { error: "Too many attempts. Try again later.", retryAfterSeconds: rate.retryAfterSeconds },
    { status: 429 }
  );
}
