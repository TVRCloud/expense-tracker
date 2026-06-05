import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { hashPassword } from "@/utils/password";
import logger from "@/lib/logger";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;
    await connectDB();

    const existing = await User.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const hashed = await hashPassword(password);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashed });

    logger.info({ userId: user._id.toString() }, "User registered");
    return NextResponse.json(
      { data: { id: user._id.toString(), name: user.name, email: user.email } },
      { status: 201 }
    );
  } catch (err) {
    logger.error({ err }, "POST /api/auth/register failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
