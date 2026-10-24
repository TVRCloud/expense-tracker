import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { isValidTimeZone } from "@/lib/spend-limit-time";
import { isSupportedCurrency } from "@/lib/currency";
import { BaseCurrencyError, setBaseCurrency } from "@/lib/base-currency";

const schema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  glassIntensity: z.enum(["subtle", "full"]).optional(),
  language: z.string().optional(),
  pushNotifications: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  weekStartsOn: z.number().min(0).max(6).optional(),
  currency: z.string().refine(isSupportedCurrency, "Unsupported currency").optional(),
  timezone: z
    .string()
    .refine(isValidTimeZone, "Unknown time zone")
    .optional(),
});

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const profile = await User.findById(user.id).select("preferences").lean();
    return NextResponse.json({ data: profile });
  } catch (err) {
    logger.error({ err }, "GET /api/me/preferences failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    // The base currency is fixed once there are transactions (see base-currency.ts).
    await connectDB();
    if (parsed.data.currency !== undefined) {
      try {
        await setBaseCurrency(user.id, parsed.data.currency);
      } catch (err) {
        if (err instanceof BaseCurrencyError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
        }
        throw err;
      }
    }

    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (k === "currency") continue;
      updates[`preferences.${k}`] = v;
    }

    const updated = await User.findByIdAndUpdate(
      user.id,
      Object.keys(updates).length ? { $set: updates } : {},
      { new: true }
    ).select("preferences").lean();

    return NextResponse.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "PATCH /api/me/preferences failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
