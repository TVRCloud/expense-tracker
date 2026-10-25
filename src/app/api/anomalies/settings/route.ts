import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import {
  anomalySettingsDiffSchema,
  anomalySettingsSchema,
  changeAnomalySettings,
  getAnomalySettings,
  updateAnomalySettings,
} from "@/lib/anomaly-settings";

// GET /api/anomalies/settings — { enabled, mutedCategories }.
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await getAnomalySettings(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/anomalies/settings failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/anomalies/settings — enabled and/or mutedCategories (replaces the list, up to 50 names).
export async function PUT(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const body = await req.json().catch(() => null);
    const parsed = anomalySettingsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Alert settings are invalid" }, { status: 400 });
    return NextResponse.json({ data: await updateAnomalySettings(user.id, parsed.data) });
  } catch (err) {
    logger.error({ err }, "PUT /api/anomalies/settings failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/anomalies/settings — { enabled?, add?, remove? }: change by what moved, atomically.
export async function PATCH(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const body = await req.json().catch(() => null);
    const parsed = anomalySettingsDiffSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Send enabled, add or remove" }, { status: 400 });
    const result = await changeAnomalySettings(user.id, parsed.data);
    if (!result) return NextResponse.json({ error: "At most 50 muted categories" }, { status: 400 });
    return NextResponse.json({ data: result });
  } catch (err) {
    logger.error({ err }, "PATCH /api/anomalies/settings failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
