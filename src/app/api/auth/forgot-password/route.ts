import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    await connectDB();
    const user = await User.findOne({ email: parsed.data.email.toLowerCase() });

    // Always 200 to prevent user enumeration
    if (!user) {
      return NextResponse.json({ data: { message: "If this email exists, a reset link was sent." } });
    }

    const token = randomBytes(32).toString("hex");
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${config.app.url}/reset-password/${token}`;
    logger.info({ userId: user._id.toString(), resetUrl }, "Password reset requested");

    // TODO: send email via nodemailer when SMTP is configured
    // await sendResetEmail(user.email, resetUrl);

    return NextResponse.json({ data: { message: "If this email exists, a reset link was sent." } });
  } catch (err) {
    logger.error({ err }, "POST /api/auth/forgot-password failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
