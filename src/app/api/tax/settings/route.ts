import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getTaxSettings, taxSettingsSchema, updateTaxSettings } from "@/lib/tax-settings";

// GET /api/tax/settings — { deductibleCategories: string[] }.
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await getTaxSettings(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/tax/settings failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/tax/settings — replace the deductible category list (up to 50 names).
export async function PUT(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const body = await req.json().catch(() => null);
    const parsed = taxSettingsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Tax settings are invalid" }, { status: 400 });
    return NextResponse.json({ data: await updateTaxSettings(user.id, parsed.data) });
  } catch (err) {
    logger.error({ err }, "PUT /api/tax/settings failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
