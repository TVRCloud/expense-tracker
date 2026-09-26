import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import ApiKey from "@/models/ApiKey";
import User from "@/models/User";
import { requireAuth } from "@/lib/auth-guard";
import { verifyPassword } from "@/utils/password";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";
import {
  API_KEY_EXPIRY_DAYS,
  MAX_ACTIVE_API_KEYS,
  activeKeyFilter,
  expiryFromDays,
  generateApiKey,
} from "@/lib/integrations/api-keys";
import logger from "@/lib/logger";
import { z } from "zod";

// Self-service API keys for /api/integrations/* callers (n8n, the mobile app,
// etc). Every key belongs to the signed-in user and acts only as them.
//
// Security notes:
//  - Creating a key needs the account password again, even with a valid
//    session, so a stolen or unattended browser session can't mint one.
//  - The raw key is returned once, in the POST response only, with
//    Cache-Control: no-store. Only its sha256 hash is stored; GET never
//    returns the hash or the key.
//  - Creation is rate-limited per user and capped at MAX_ACTIVE_API_KEYS
//    live keys.
//  - Keys are never deleted. Revoked and expired keys stay in the list as a
//    record.

const createSchema = z.object({
  label: z.string().trim().min(1).max(50),
  expiresInDays: z
    .number()
    .int()
    .refine((d) => (API_KEY_EXPIRY_DAYS as readonly number[]).includes(d), "Unsupported expiry")
    .nullable(),
  currentPassword: z.string().min(1),
});

const CREATE_LIMIT = 5;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

const PUBLIC_FIELDS = "label lastFour revoked revokedAt expiresAt lastUsedAt lastUsedIp createdVia createdAt";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const keys = await ApiKey.find({ user: user.id }).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).lean();

    return NextResponse.json({ data: keys });
  } catch (err) {
    logger.error({ err }, "GET /api/me/api-keys failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    // Counted before the password check so wrong-password attempts also use
    // up the quota and can't be used to guess the password.
    const limit = await checkSecurityRateLimit({
      key: `api-key-create:${user.id}`,
      limit: CREATE_LIMIT,
      windowMs: CREATE_WINDOW_MS,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    await connectDB();
    const dbUser = await User.findOne({ _id: user.id, isActive: true }).select("password").lean<{ password: string }>();
    if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const valid = await verifyPassword(parsed.data.currentPassword, dbUser.password);
    if (!valid) {
      logger.warn({ userId: user.id }, "API key creation refused: wrong password");
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const activeCount = await ApiKey.countDocuments({ user: user.id, ...activeKeyFilter() });
    if (activeCount >= MAX_ACTIVE_API_KEYS) {
      return NextResponse.json(
        { error: `You can have at most ${MAX_ACTIVE_API_KEYS} active keys. Revoke one first.` },
        { status: 400 }
      );
    }

    const { rawKey, keyHash, lastFour } = generateApiKey();
    const apiKey = await ApiKey.create({
      user: user.id,
      label: parsed.data.label,
      keyHash,
      lastFour,
      expiresAt: expiryFromDays(parsed.data.expiresInDays),
      createdVia: "web",
    });

    // Never log the raw key.
    logger.info({ userId: user.id, apiKeyId: apiKey._id.toString() }, "API key created");
    return NextResponse.json(
      {
        data: {
          _id: apiKey._id,
          label: apiKey.label,
          lastFour: apiKey.lastFour,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
          key: rawKey,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error({ err }, "POST /api/me/api-keys failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
