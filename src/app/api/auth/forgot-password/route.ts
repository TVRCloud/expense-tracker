import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { z } from "zod";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";

const schema = z.object({ email: z.string().email() });

function genericResponse() {
  return NextResponse.json({ data: { message: "If this email exists, a reset link was sent." } });
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();

    // Rate limit before touching the DB — per-email (stop mail-bombing one
    // address) and per-IP (stop mass enumeration/spam from one source).
    const [emailLimit, ipLimit] = await Promise.all([
      checkSecurityRateLimit({ key: `password-reset:${email}`, limit: 5, windowMs: 60 * 60 * 1000 }),
      checkSecurityRateLimit({ key: `password-reset-ip:${clientIp(req)}`, limit: 20, windowMs: 60 * 60 * 1000 }),
    ]);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      // Still return the generic message — don't reveal rate limiting to a
      // potential enumeration attempt via a different response shape.
      return genericResponse();
    }

    await connectDB();
    const user = await User.findOne({ email });

    // Always 200 to prevent user enumeration
    if (!user) {
      return genericResponse();
    }

    const token = randomBytes(32).toString("hex");
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${config.app.url}/reset-password/${token}`;
    // Never log resetUrl/token here — sendPasswordResetEmail owns delivery
    // and only logs a dev-only fallback link when SMTP isn't configured.
    logger.info({ userId: user._id.toString() }, "Password reset requested");
    await sendPasswordResetEmail(user.email, resetUrl);

    return genericResponse();
  } catch (err) {
    logger.error({ err }, "POST /api/auth/forgot-password failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
